import { describe, expect, it } from 'bun:test';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { storeRecovery } from './custody';
import { RunLedger, type AssetLocation } from './ledger';
import { assertNoStartupLiabilities, auditStartupLiabilities } from './startup';

const asset: AssetLocation = {
  mintUrl: 'https://mint.sovran.money',
  unit: 'sat',
  accountIndex: 0,
};
const root = () => mkdtempSync(join(tmpdir(), 'e2e-startup-'));

const ledgerWithIntent = (base: string, runId: string, legId: string) => {
  const runDir = join(base, runId);
  const custody = storeRecovery(runDir, 'mnemonic', 'test recovery material');
  const ledger = new RunLedger(runDir, runId, () => 1);
  ledger.registerFunding({
    legId,
    custody,
    counterparty: 'cocod',
    asset,
    expectedAmount: 100,
  });
  return ledger;
};

describe('startup liability audit', () => {
  it('is clean when there are no ledgers', () => {
    expect(auditStartupLiabilities(root())).toEqual({ status: 'clean', blockers: [] });
  });

  it('blocks destructive startup for intent, funded, and quarantined legs', () => {
    const base = root();
    const intent = ledgerWithIntent(base, 'run-intent', 'leg-intent');
    const funded = ledgerWithIntent(base, 'run-funded', 'leg-funded');
    funded.markFunded('leg-funded', { amount: 100, fees: 0 });
    const quarantined = ledgerWithIntent(base, 'run-quarantine', 'leg-quarantine');
    quarantined.markFunded('leg-quarantine', { amount: 100, fees: 0 });
    quarantined.quarantine('leg-quarantine', 'mint unavailable');

    const audit = auditStartupLiabilities(base);

    expect(audit.status).toBe('blocked');
    expect(audit.blockers.map(({ runId, legId, status }) => ({ runId, legId, status }))).toEqual([
      { runId: 'run-funded', legId: 'leg-funded', status: 'funded' },
      { runId: 'run-intent', legId: 'leg-intent', status: 'intent' },
      { runId: 'run-quarantine', legId: 'leg-quarantine', status: 'quarantined' },
    ]);
    expect(() => assertNoStartupLiabilities(base)).toThrow(/3 unresolved fund liabilities/);
    expect(intent.blockingLegs()).toHaveLength(1);
  });

  it('reports the intent crash window read-only and requires quarantine before effects', () => {
    const base = root();
    ledgerWithIntent(base, 'run-intent', 'leg-intent');
    const path = join(base, 'run-intent', 'ledger.jsonl');
    const before = readFileSync(path, 'utf8');

    const audit = auditStartupLiabilities(base);

    expect(audit.blockers).toContainEqual(
      expect.objectContaining({
        runId: 'run-intent',
        legId: 'leg-intent',
        crashWindow: 'intent-durable-effect-unconfirmed',
        resume: {
          action: 'quarantine-before-any-effect',
          automaticValueEffectsAllowed: false,
        },
      })
    );
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('distinguishes funded, outflow, sweep, and quarantine crash windows', () => {
    const base = root();
    const funded = ledgerWithIntent(base, 'run-funded', 'leg-funded');
    funded.markFunded('leg-funded', { amount: 100, fees: 0 });
    const outflow = ledgerWithIntent(base, 'run-outflow', 'leg-outflow');
    outflow.markFunded('leg-outflow', { amount: 100, fees: 0 });
    outflow.recordOutflow('leg-outflow', { amount: 40, fees: 0, counterparty: 'cocod' });
    const swept = ledgerWithIntent(base, 'run-swept', 'leg-swept');
    swept.markFunded('leg-swept', { amount: 100, fees: 0 });
    swept.recordSweep('leg-swept', {
      asset,
      ok: true,
      recoveredAmount: 100,
      residualAmount: 0,
    });
    const quarantined = ledgerWithIntent(base, 'run-quarantined', 'leg-quarantined');
    quarantined.quarantine('leg-quarantined', 'operator-halt');

    const windows = new Map(
      auditStartupLiabilities(base).blockers.map((blocker) => [blocker.legId, blocker.crashWindow])
    );

    expect(windows).toEqual(
      new Map([
        ['leg-funded', 'funded-durable-sweep-pending'],
        ['leg-outflow', 'outflow-durable-sweep-pending'],
        ['leg-quarantined', 'intent-durable-effect-unconfirmed'],
        ['leg-swept', 'sweep-durable-reconcile-pending'],
      ])
    );
  });

  it('does not block after exact reconciliation', () => {
    const base = root();
    const ledger = ledgerWithIntent(base, 'run-clean', 'leg-clean');
    ledger.markFunded('leg-clean', { amount: 100, fees: 0 });
    ledger.recordSweep('leg-clean', {
      asset,
      ok: true,
      recoveredAmount: 100,
      residualAmount: 0,
    });
    ledger.reconcile('leg-clean');

    expect(auditStartupLiabilities(base)).toEqual({ status: 'clean', blockers: [] });
    expect(() => assertNoStartupLiabilities(base)).not.toThrow();
  });

  it('blocks on a retained value-effect lease even if the ledger was reconciled directly', () => {
    const base = root();
    const ledger = ledgerWithIntent(base, 'run-lease', 'leg-lease');
    ledger.acquireEffectLease('leg-lease');
    ledger.markFunded('leg-lease', { amount: 100, fees: 0 });
    ledger.recordSweep('leg-lease', {
      asset,
      ok: true,
      recoveredAmount: 100,
      residualAmount: 0,
    });
    ledger.reconcile('leg-lease');

    expect(auditStartupLiabilities(base).blockers).toContainEqual(
      expect.objectContaining({
        status: 'effect-lease',
        crashWindow: 'value-effect-outcome-uncertain',
        resume: expect.objectContaining({ automaticValueEffectsAllowed: false }),
      })
    );
  });

  it('fails closed on a corrupt ledger instead of erasing past it', () => {
    const base = root();
    const runDir = join(base, 'run-corrupt');
    mkdirSync(runDir, { recursive: true });
    appendFileSync(join(runDir, 'ledger.jsonl'), '{ invalid\n');

    const audit = auditStartupLiabilities(base);

    expect(audit).toMatchObject({
      status: 'blocked',
      blockers: [{ runId: 'unknown', legId: 'unknown', status: 'corrupt' }],
    });
    expect(() => assertNoStartupLiabilities(base)).toThrow(/corrupt/);
  });

  it('treats an empty discovered ledger as corrupt', () => {
    const base = root();
    const runDir = join(base, 'run-empty');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'ledger.jsonl'), '', { mode: 0o600 });

    expect(auditStartupLiabilities(base)).toMatchObject({
      status: 'blocked',
      blockers: [
        {
          status: 'corrupt',
          crashWindow: 'ledger-unreadable',
          resume: { automaticValueEffectsAllowed: false },
        },
      ],
    });
  });

  it('blocks on orphan recovery custody left by a pre-ledger run', () => {
    const base = root();
    const custodyDir = join(base, 'legacy', 'custody');
    mkdirSync(custodyDir, { recursive: true });
    writeFileSync(join(custodyDir, 'orphan.secret'), 'do not read or delete');

    expect(auditStartupLiabilities(base)).toMatchObject({
      status: 'blocked',
      blockers: [
        {
          runId: 'unknown',
          legId: 'unknown',
          status: 'orphan-custody',
        },
      ],
    });
  });

  it('blocks on legacy seed-export records without exposing their contents or fingerprints', () => {
    const base = root();
    const first = 'first raw historical recovery value';
    const second = 'second raw historical recovery value';
    writeFileSync(
      join(base, 'metro.log'),
      `prefix E2E_SEED_EXPORT ${first}\nprefix E2E_SEED_EXPORT ${second}\n`,
      { mode: 0o600 }
    );

    const audit = auditStartupLiabilities(base);
    const rendered = JSON.stringify(audit);

    expect(audit.blockers).toContainEqual(
      expect.objectContaining({
        ledgerPath: 'metro.log',
        status: 'legacy-seed-records',
        reason: '2 seed-export records lack a run-relative liability ledger',
      })
    );
    expect(rendered).not.toContain(first);
    expect(rendered).not.toContain(second);
    expect(rendered).not.toMatch(/[0-9a-f]{12}/);
  });

  it('does not treat scrubbed funded-session Metro markers as raw legacy seed records', () => {
    const base = root();
    writeFileSync(join(base, 'metro.log'), 'LOG E2E_SEED_EXPORT [captured]\n', { mode: 0o600 });
    expect(auditStartupLiabilities(base)).toEqual({ status: 'clean', blockers: [] });
  });

  it('blocks on a known legacy seed artifact without reading values into the audit', () => {
    const base = root();
    const raw = 'raw legacy seed value';
    writeFileSync(join(base, 'legacy-SEEDS.json'), JSON.stringify([raw]), { mode: 0o600 });

    const audit = auditStartupLiabilities(base);

    expect(audit.blockers).toContainEqual(
      expect.objectContaining({
        ledgerPath: 'legacy-SEEDS.json',
        status: 'legacy-seed-artifact',
      })
    );
    expect(JSON.stringify(audit)).not.toContain(raw);
  });

  it('resolves custody relative to its run so matching basenames cannot cross-satisfy', () => {
    const base = root();
    const runA = join(base, 'run-a');
    const runB = join(base, 'run-b');
    const ledger = ledgerWithIntent(base, 'run-a', 'leg-a');
    const sameHandle = storeRecovery(runB, 'mnemonic', 'test recovery material');
    unlinkSync(join(runA, 'custody', `${sameHandle.id}.secret`));

    const audit = auditStartupLiabilities(base);

    expect(audit.status).toBe('blocked');
    expect(audit.blockers.map(({ ledgerPath, status }) => ({ ledgerPath, status }))).toContainEqual(
      {
        ledgerPath: 'run-a/ledger.jsonl',
        status: 'invalid-custody',
      }
    );
    expect(audit.blockers.map(({ ledgerPath, status }) => ({ ledgerPath, status }))).toContainEqual(
      {
        ledgerPath: `run-b/custody/${sameHandle.id}.secret`,
        status: 'orphan-custody',
      }
    );
    expect(ledger.blockingLegs()).toHaveLength(1);
  });
});
