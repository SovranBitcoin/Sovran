import { describe, expect, it } from 'bun:test';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  deleteRecovery,
  hasCustody,
  loadRecovery,
  storeRecovery,
  type CustodyHandle,
} from './custody';
import { RunLedger, type AssetLocation } from './ledger';

const MNEMONIC = [
  'abandon',
  'ability',
  'able',
  'about',
  'above',
  'absent',
  'absorb',
  'abstract',
  'absurd',
  'abuse',
  'access',
  'accident',
].join(' ');
const dir = () => mkdtempSync(join(tmpdir(), 'e2e-ledger-'));
let n = 0;
const clock = () => (n += 1);
const SAT_ACCOUNT_0: AssetLocation = {
  mintUrl: 'https://mint.sovran.money',
  unit: 'sat',
  accountIndex: 0,
};

describe('custody', () => {
  it('stores recovery behind a handle with no raw value and 0600 permissions', () => {
    const base = dir();
    const handle = storeRecovery(base, 'mnemonic', MNEMONIC);

    expect(JSON.stringify(handle)).not.toContain(MNEMONIC);
    expect(handle.fingerprint).toHaveLength(12);
    expect(hasCustody(base, handle)).toBe(true);
    expect(statSync(join(base, 'custody', `${handle.id}.secret`)).mode & 0o777).toBe(0o600);
    expect(loadRecovery(base, handle).reveal()).toBe(MNEMONIC);
  });

  it('rejects a fingerprint mismatch', () => {
    const base = dir();
    const handle = storeRecovery(base, 'mnemonic', MNEMONIC);

    expect(() => loadRecovery(base, { ...handle, fingerprint: 'deadbeefdead' })).toThrow();
  });

  it('validates custody content and recorded length instead of file presence', () => {
    const base = dir();
    const handle = storeRecovery(base, 'mnemonic', MNEMONIC);
    const secretPath = join(base, 'custody', `${handle.id}.secret`);

    writeFileSync(secretPath, 'x'.repeat(MNEMONIC.length), { mode: 0o600 });

    expect(hasCustody(base, handle)).toBe(false);
    expect(() => loadRecovery(base, handle)).toThrow(/fingerprint/);

    writeFileSync(secretPath, MNEMONIC, { mode: 0o600 });
    expect(hasCustody(base, { ...handle, len: handle.len + 1 })).toBe(false);
    expect(() => loadRecovery(base, { ...handle, len: handle.len + 1 })).toThrow(/length/);
  });

  it('deletes both private material and its metadata only after an explicit call', () => {
    const base = mkdtempSync(join(tmpdir(), 'e2e-ledger-'));
    const handle = storeRecovery(base, 'mnemonic', MNEMONIC);
    expect(hasCustody(base, handle)).toBe(true);
    deleteRecovery(base, handle);
    expect(hasCustody(base, handle)).toBe(false);
    expect(existsSync(join(base, 'custody', `${handle.id}.json`))).toBe(false);
  });
});

describe('RunLedger fund lifecycle', () => {
  const setup = () => {
    const base = dir();
    const custody = storeRecovery(base, 'mnemonic', MNEMONIC);
    return { base, custody, ledger: new RunLedger(base, 'run-1', clock) };
  };
  const intent = (
    ledger: RunLedger,
    custody: CustodyHandle,
    legId = 'leg-a',
    asset = SAT_ACCOUNT_0
  ) =>
    ledger.registerFunding({
      legId,
      custody,
      counterparty: 'cocod',
      asset,
      expectedAmount: 100,
    });

  it('refuses a funding intent without recovery custody', () => {
    const base = dir();
    const ledger = new RunLedger(base, 'run-x', clock);
    const missing: CustodyHandle = {
      id: 'missing',
      kind: 'mnemonic',
      len: 1,
      fingerprint: 'x'.repeat(12),
    };

    expect(() =>
      ledger.registerFunding({
        legId: 'leg-a',
        custody: missing,
        counterparty: 'cocod',
        asset: SAT_ACCOUNT_0,
        expectedAmount: 100,
      })
    ).toThrow(/custody/);
  });

  it('records the concrete mint, unit, and account before funding', () => {
    const { custody, ledger } = setup();
    const usdAccount2: AssetLocation = {
      mintUrl: 'https://mint.cubabitcoin.org',
      unit: 'usd',
      accountIndex: 2,
    };

    intent(ledger, custody, 'leg-usd', usdAccount2);

    expect(ledger.read()[0]).toMatchObject({
      kind: 'intent',
      legId: 'leg-usd',
      asset: usdAccount2,
      expectedAmount: 100,
    });
  });

  it('rejects funding completion without an intent or with the wrong amount', () => {
    const { custody, ledger } = setup();
    intent(ledger, custody);

    expect(() => ledger.markFunded('unknown', { amount: 100, fees: 0 })).toThrow(/intent/);
    expect(() => ledger.markFunded('leg-a', { amount: 99, fees: 0 })).toThrow(/expected 100/);
  });

  it('terminates an intent only after recovery proves its value effect was not observed', () => {
    const { custody, ledger } = setup();
    intent(ledger, custody);

    ledger.cancelFunding('leg-a');

    expect(ledger.status().get('leg-a')).toBe('cancelled');
    expect(ledger.blockingLegs()).toEqual([]);
    expect(() => ledger.markFunded('leg-a', { amount: 100, fees: 0 })).toThrow(
      /after reconciled or cancelled/
    );
  });

  it('reconciles only after exact conservation and a successful zero-residual sweep', () => {
    const { custody, ledger } = setup();
    intent(ledger, custody);
    ledger.markFunded('leg-a', { amount: 100, fees: 0, txId: 'fund-1' });
    ledger.recordOutflow('leg-a', {
      amount: 40,
      fees: 1,
      counterparty: 'cocod',
      txId: 'send-1',
    });
    ledger.recordSweep('leg-a', {
      asset: SAT_ACCOUNT_0,
      ok: true,
      recoveredAmount: 59,
      residualAmount: 0,
      txId: 'sweep-1',
    });

    expect(ledger.reconcile('leg-a')).toEqual({
      ok: true,
      fundedAmount: 100,
      recoveredAmount: 59,
      outflowAmount: 40,
      writtenOffAmount: 0,
      fees: 1,
    });
    expect(ledger.status().get('leg-a')).toBe('reconciled');
    expect(ledger.blockingLegs()).toEqual([]);
  });

  it('accepts an operator write-off only after funding and within the funded principal', () => {
    const { custody, ledger } = setup();
    intent(ledger, custody);
    expect(() => ledger.writeOff('leg-a', { amount: 100, reason: 'stranded' })).toThrow(
      /funded entry missing/
    );

    ledger.markFunded('leg-a', { amount: 100, fees: 0 });
    ledger.recordOutflow('leg-a', { amount: 40, fees: 0, counterparty: 'cocod' });
    expect(() => ledger.writeOff('leg-a', { amount: 61, reason: 'stranded' })).toThrow(
      /exceeds funded principal/
    );

    ledger.writeOff('leg-a', {
      amount: 60,
      reason: 'paid mint quote unclaimable — quote id lost with ephemeral simulator',
    });
    ledger.recordSweep('leg-a', {
      asset: SAT_ACCOUNT_0,
      ok: true,
      recoveredAmount: 0,
      residualAmount: 0,
    });
    expect(ledger.reconcile('leg-a')).toEqual({
      ok: true,
      fundedAmount: 100,
      recoveredAmount: 0,
      outflowAmount: 40,
      writtenOffAmount: 60,
      fees: 0,
    });
    expect(ledger.status().get('leg-a')).toBe('reconciled');
    expect(ledger.read().at(-1)).toEqual(
      expect.objectContaining({ kind: 'reconciled', writtenOffAmount: 60 })
    );
  });

  it('refuses to reconcile when a write-off does not close conservation', () => {
    const { custody, ledger } = setup();
    intent(ledger, custody);
    ledger.markFunded('leg-a', { amount: 100, fees: 0 });
    ledger.writeOff('leg-a', { amount: 60, reason: 'partial' });
    ledger.recordSweep('leg-a', {
      asset: SAT_ACCOUNT_0,
      ok: true,
      recoveredAmount: 0,
      residualAmount: 0,
    });
    expect(() => ledger.reconcile('leg-a')).toThrow(/conservation mismatch/);
  });

  it('rejects a successful sweep whose value does not conserve', () => {
    const { custody, ledger } = setup();
    intent(ledger, custody);
    ledger.markFunded('leg-a', { amount: 100, fees: 0 });
    ledger.recordOutflow('leg-a', { amount: 40, fees: 0, counterparty: 'cocod' });
    ledger.recordSweep('leg-a', {
      asset: SAT_ACCOUNT_0,
      ok: true,
      recoveredAmount: 50,
      residualAmount: 0,
    });

    expect(() => ledger.reconcile('leg-a')).toThrow(/conservation/);
    expect(ledger.blockingLegs()).toEqual([
      { legId: 'leg-a', status: 'swept', asset: SAT_ACCOUNT_0 },
    ]);
  });

  it('makes a successful zero-residual sweep terminal for further value effects', () => {
    const { custody, ledger } = setup();
    intent(ledger, custody);
    ledger.markFunded('leg-a', { amount: 100, fees: 0 });
    ledger.recordSweep('leg-a', {
      asset: SAT_ACCOUNT_0,
      ok: true,
      recoveredAmount: 100,
      residualAmount: 0,
    });

    expect(() =>
      ledger.recordSweep('leg-a', {
        asset: SAT_ACCOUNT_0,
        ok: true,
        recoveredAmount: 100,
        residualAmount: 0,
      })
    ).toThrow(/after successful sweep/);
    expect(() =>
      ledger.recordOutflow('leg-a', { amount: 1, fees: 0, counterparty: 'cocod' })
    ).toThrow(/after successful sweep/);
    expect(ledger.status().get('leg-a')).toBe('swept');
  });

  it('rejects a residual, failed, or wrong-location sweep', () => {
    const { custody, ledger } = setup();
    intent(ledger, custody);
    ledger.markFunded('leg-a', { amount: 100, fees: 0 });

    expect(() =>
      ledger.recordSweep('leg-a', {
        asset: { ...SAT_ACCOUNT_0, accountIndex: 1 },
        ok: true,
        recoveredAmount: 100,
        residualAmount: 0,
      })
    ).toThrow(/asset location/);

    ledger.recordSweep('leg-a', {
      asset: SAT_ACCOUNT_0,
      ok: false,
      recoveredAmount: 0,
      residualAmount: 100,
    });
    expect(() => ledger.reconcile('leg-a')).toThrow(/sweep/);
  });

  it('keeps quarantined legs as startup blockers', () => {
    const { custody, ledger } = setup();
    intent(ledger, custody);
    ledger.markFunded('leg-a', { amount: 100, fees: 0 });
    ledger.quarantine('leg-a', 'mint unreachable');

    expect(ledger.status().get('leg-a')).toBe('quarantined');
    expect(ledger.blockingLegs()).toEqual([
      { legId: 'leg-a', status: 'quarantined', asset: SAT_ACCOUNT_0 },
    ]);
  });

  it('treats repeated funding as separate legs and rejects duplicate leg ids', () => {
    const { custody, ledger } = setup();
    intent(ledger, custody, 'leg-a');
    intent(ledger, custody, 'leg-b');

    expect(ledger.status().size).toBe(2);
    expect(() => intent(ledger, custody, 'leg-a')).toThrow(/duplicate/);
  });

  it('fails closed on malformed JSON and valid JSON with an invalid shape', () => {
    const malformed = setup();
    intent(malformed.ledger, malformed.custody);
    appendFileSync(join(malformed.base, 'ledger.jsonl'), '{ not json\n');
    expect(() => malformed.ledger.read()).toThrow(/line 2/);

    const invalid = setup();
    appendFileSync(
      join(invalid.base, 'ledger.jsonl'),
      `${JSON.stringify({ v: 1, runId: 'run-1', legId: 'leg-x', ts: 1, kind: 'funded' })}\n`
    );
    expect(() => invalid.ledger.read()).toThrow(/line 1/);
  });

  it('fails closed when a discovered ledger exists but is empty', () => {
    const { base, ledger } = setup();
    writeFileSync(join(base, 'ledger.jsonl'), '', { mode: 0o600 });

    expect(() => ledger.read()).toThrow(/empty/);
  });

  it('fails closed on a valid entry shape with an impossible transition', () => {
    const invalid = setup();
    appendFileSync(
      join(invalid.base, 'ledger.jsonl'),
      `${JSON.stringify({
        v: 1,
        runId: 'run-1',
        legId: 'leg-x',
        ts: 1,
        kind: 'funded',
        amount: 100,
        fees: 0,
      })}\n`
    );

    expect(() => invalid.ledger.read()).toThrow(/funded entry before intent/);
  });

  it('never writes the mnemonic to the public ledger', () => {
    const { base, custody, ledger } = setup();
    intent(ledger, custody);

    expect(readFileSync(join(base, 'ledger.jsonl'), 'utf8')).not.toContain(MNEMONIC);
  });

  it('validates the complete transition before durably appending a record', () => {
    const { base, custody, ledger } = setup();
    intent(ledger, custody);
    ledger.markFunded('leg-a', { amount: 100, fees: 0 });
    ledger.recordSweep('leg-a', {
      asset: SAT_ACCOUNT_0,
      ok: true,
      recoveredAmount: 100,
      residualAmount: 0,
    });
    ledger.reconcile('leg-a');
    const before = readFileSync(join(base, 'ledger.jsonl'), 'utf8');

    expect(() =>
      ledger.recordOutflow('leg-a', { amount: 1, fees: 0, counterparty: 'cocod' })
    ).toThrow(/after reconciled/);
    expect(readFileSync(join(base, 'ledger.jsonl'), 'utf8')).toBe(before);
    expect(ledger.status().get('leg-a')).toBe('reconciled');
  });
});
