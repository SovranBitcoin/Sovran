import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FundingCoordinator, type CustodyReadiness, type FundingEffects } from './coordinator';
import { storeRecovery } from './custody';
import { RunLedger, type AssetLocation } from './ledger';
import { auditStartupLiabilities } from './startup';

const asset: AssetLocation = {
  mintUrl: 'https://mint.cubabitcoin.org',
  unit: 'usd',
  accountIndex: 2,
};

const setup = (overrides: Partial<FundingEffects> = {}) => {
  const base = mkdtempSync(join(tmpdir(), 'e2e-coordinator-'));
  const custody = storeRecovery(base, 'mnemonic', 'test recovery material');
  const ledger = new RunLedger(base, 'run-coordinator', () => 1);
  const effects: FundingEffects = {
    fund: async () => ({ amount: 100, fees: 0, txId: 'fund-1' }),
    outflow: async ({ amount }) => ({ amount, fees: 0, txId: 'outflow-1' }),
    sweep: async () => ({ ok: true, recoveredAmount: 100, residualAmount: 0, fees: 0 }),
    ...overrides,
  };
  const readinessChecks: unknown[] = [];
  const readiness: CustodyReadiness = {
    assertReady: (request) => readinessChecks.push(request),
  };
  const coordinator = new FundingCoordinator(ledger, effects, readiness);
  return { base, coordinator, custody, effects, ledger, readinessChecks };
};

describe('FundingCoordinator', () => {
  it('durably records exact intent and custody readiness before invoking funding', async () => {
    const seenAtEffect: unknown[] = [];
    let ledger!: RunLedger;
    const context = setup({
      fund: async (request) => {
        seenAtEffect.push({ request, entries: ledger.read() });
        return { amount: 100, fees: 0, txId: 'fund-1' };
      },
    });
    ledger = context.ledger;
    const intent = context.coordinator.prepareFunding({
      legId: 'leg-usd',
      custody: context.custody,
      counterparty: 'cocod-test-wallet',
      asset,
      expectedAmount: 100,
    });

    const funded = await context.coordinator.fund(intent);

    expect(seenAtEffect).toEqual([
      {
        request: {
          runId: 'run-coordinator',
          legId: 'leg-usd',
          custody: context.custody,
          counterparty: 'cocod-test-wallet',
          asset,
          expectedAmount: 100,
        },
        entries: [expect.objectContaining({ kind: 'intent', asset, custody: context.custody })],
      },
    ]);
    expect(context.readinessChecks).toHaveLength(2);
    expect(funded.state).toBe('funded');
    expect(context.ledger.read().map((entry) => entry.kind)).toEqual(['intent', 'funded']);
  });

  it('quarantines an ambiguous funding effect without persisting adapter errors', async () => {
    const context = setup({
      fund: async () => {
        throw new Error('cashuA-secret-material-must-not-enter-ledger');
      },
    });
    const intent = context.coordinator.prepareFunding({
      legId: 'leg-uncertain',
      custody: context.custody,
      counterparty: 'cocod-test-wallet',
      asset,
      expectedAmount: 100,
    });

    await expect(context.coordinator.fund(intent)).rejects.toThrow(/outcome is uncertain/);

    expect(context.ledger.status().get('leg-uncertain')).toBe('quarantined');
    expect(JSON.stringify(context.ledger.read())).not.toContain('secret-material');
    expect(context.ledger.read().at(-1)).toMatchObject({
      kind: 'quarantined',
      reason: 'funding-effect-uncertain',
    });
  });

  it('records outflow and sweep effects against the exact asset before reconciliation', async () => {
    const effectRequests: unknown[] = [];
    const context = setup({
      outflow: async (request) => {
        effectRequests.push({ kind: 'outflow', request });
        return { amount: request.amount, fees: 1, txId: 'outflow-1' };
      },
      sweep: async (request) => {
        effectRequests.push({ kind: 'sweep', request });
        return { ok: true, recoveredAmount: 59, residualAmount: 0, fees: 0 };
      },
    });
    const intent = context.coordinator.prepareFunding({
      legId: 'leg-lifecycle',
      custody: context.custody,
      counterparty: 'cocod-test-wallet',
      asset,
      expectedAmount: 100,
    });
    const funded = await context.coordinator.fund(intent);

    const afterOutflow = await context.coordinator.outflow(funded, {
      amount: 40,
      counterparty: 'cocod-test-wallet',
    });
    const swept = await context.coordinator.sweep(afterOutflow);
    const reconciled = context.coordinator.reconcile(swept);

    expect(effectRequests).toEqual([
      {
        kind: 'outflow',
        request: {
          runId: 'run-coordinator',
          legId: 'leg-lifecycle',
          custody: context.custody,
          asset,
          amount: 40,
          counterparty: 'cocod-test-wallet',
        },
      },
      {
        kind: 'sweep',
        request: {
          runId: 'run-coordinator',
          legId: 'leg-lifecycle',
          custody: context.custody,
          asset,
        },
      },
    ]);
    expect(context.readinessChecks).toHaveLength(4);
    expect(reconciled.state).toBe('reconciled');
    expect(context.ledger.read().map((entry) => entry.kind)).toEqual([
      'intent',
      'funded',
      'outflow',
      'sweep',
      'reconciled',
    ]);
  });

  it('consumes each issued capability so a stale handle cannot repeat an effect', async () => {
    let outflows = 0;
    const context = setup({
      outflow: async ({ amount }) => {
        outflows += 1;
        return { amount, fees: 0 };
      },
    });
    const intent = context.coordinator.prepareFunding({
      legId: 'leg-linear',
      custody: context.custody,
      counterparty: 'cocod-test-wallet',
      asset,
      expectedAmount: 100,
    });
    const funded = await context.coordinator.fund(intent);

    await context.coordinator.outflow(funded, { amount: 10, counterparty: 'cocod' });
    await expect(
      context.coordinator.outflow(funded, { amount: 10, counterparty: 'cocod' })
    ).rejects.toThrow(/capability/);

    expect(outflows).toBe(1);
  });

  it('resumes a crashed funded leg only through durable quarantine before sweeping', async () => {
    const initial = setup();
    const intent = initial.coordinator.prepareFunding({
      legId: 'leg-resume',
      custody: initial.custody,
      counterparty: 'cocod-test-wallet',
      asset,
      expectedAmount: 100,
    });
    await initial.coordinator.fund(intent);
    const entriesSeenBySweep: string[][] = [];
    const resumed = new FundingCoordinator(
      initial.ledger,
      {
        fund: async () => {
          throw new Error('restart must never retry funding');
        },
        outflow: async () => {
          throw new Error('restart must never resume with an outflow capability');
        },
        sweep: async () => {
          entriesSeenBySweep.push(initial.ledger.read().map((entry) => entry.kind));
          return { ok: true, recoveredAmount: 100, residualAmount: 0, fees: 0 };
        },
      },
      { assertReady: () => {} }
    );

    const quarantine = resumed.quarantineForResume('leg-resume');
    if (quarantine.state !== 'quarantined') throw new Error('expected funded resume');
    const swept = await resumed.sweep(quarantine);

    expect(entriesSeenBySweep).toEqual([['intent', 'funded', 'quarantined']]);
    expect(auditStartupLiabilities(initial.base).blockers).toContainEqual(
      expect.objectContaining({
        legId: 'leg-resume',
        crashWindow: 'sweep-durable-reconcile-pending',
      })
    );
    expect(resumed.reconcile(swept).state).toBe('reconciled');
  });

  it('quarantines an intent-only restart but issues no value-effect capability', () => {
    const initial = setup();
    initial.coordinator.prepareFunding({
      legId: 'leg-unconfirmed',
      custody: initial.custody,
      counterparty: 'cocod-test-wallet',
      asset,
      expectedAmount: 100,
    });
    const resumed = new FundingCoordinator(initial.ledger, initial.effects, {
      assertReady: () => {},
    });

    expect(() => resumed.quarantineForResume('leg-unconfirmed')).toThrow(/unconfirmed/);
    expect(initial.ledger.status().get('leg-unconfirmed')).toBe('quarantined');
  });

  it('reconciles a durable zero-residual sweep after restart without sweeping twice', async () => {
    const initial = setup();
    const intent = initial.coordinator.prepareFunding({
      legId: 'leg-swept-crash',
      custody: initial.custody,
      counterparty: 'cocod-test-wallet',
      asset,
      expectedAmount: 100,
    });
    const funded = await initial.coordinator.fund(intent);
    await initial.coordinator.sweep(funded);
    let repeatedSweeps = 0;
    const resumed = new FundingCoordinator(
      initial.ledger,
      {
        ...initial.effects,
        sweep: async () => {
          repeatedSweeps += 1;
          return { ok: true, recoveredAmount: 100, residualAmount: 0, fees: 0 };
        },
      },
      { assertReady: () => {} }
    );

    const swept = resumed.quarantineForResume('leg-swept-crash');

    expect(swept.state).toBe('swept');
    expect(auditStartupLiabilities(initial.base).blockers).toContainEqual(
      expect.objectContaining({ crashWindow: 'sweep-durable-reconcile-pending' })
    );
    if (swept.state !== 'swept') throw new Error('expected swept resume');
    expect(resumed.reconcile(swept).state).toBe('reconciled');
    expect(repeatedSweeps).toBe(0);
  });

  it('serializes two coordinator instances and rejects the stale sweep capability', async () => {
    const initial = setup();
    const intent = initial.coordinator.prepareFunding({
      legId: 'leg-concurrent',
      custody: initial.custody,
      counterparty: 'cocod-test-wallet',
      asset,
      expectedAmount: 100,
    });
    await initial.coordinator.fund(intent);

    let releaseSweep!: () => void;
    let markStarted!: () => void;
    const sweepGate = new Promise<void>((resolve) => {
      releaseSweep = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let sweepCalls = 0;
    const effects: FundingEffects = {
      ...initial.effects,
      sweep: async () => {
        sweepCalls += 1;
        markStarted();
        await sweepGate;
        return { ok: true, recoveredAmount: 100, residualAmount: 0, fees: 0 };
      },
    };
    const first = new FundingCoordinator(initial.ledger, effects, { assertReady: () => {} });
    const second = new FundingCoordinator(initial.ledger, effects, { assertReady: () => {} });
    const firstLeg = first.quarantineForResume('leg-concurrent');
    const secondLeg = second.quarantineForResume('leg-concurrent');
    if (firstLeg.state !== 'quarantined' || secondLeg.state !== 'quarantined') {
      throw new Error('expected quarantined resume capabilities');
    }

    const firstSweep = first.sweep(firstLeg);
    await started;
    await expect(second.sweep(secondLeg)).rejects.toThrow(/lease is already held/);
    releaseSweep();
    const swept = await firstSweep;

    expect(sweepCalls).toBe(1);
    expect(initial.ledger.status().get('leg-concurrent')).toBe('swept');
    await expect(second.sweep(secondLeg)).rejects.toThrow(/capability/);
    expect(first.reconcile(swept).state).toBe('reconciled');
  });

  it('retains the durable lease after an uncertain effect and prevents automatic replay', async () => {
    const initial = setup({
      sweep: async () => {
        throw new Error('connection closed after request');
      },
    });
    const intent = initial.coordinator.prepareFunding({
      legId: 'leg-uncertain-sweep',
      custody: initial.custody,
      counterparty: 'cocod-test-wallet',
      asset,
      expectedAmount: 100,
    });
    const funded = await initial.coordinator.fund(intent);

    await expect(initial.coordinator.sweep(funded)).rejects.toThrow(/outcome is uncertain/);

    let replayCalls = 0;
    const resumed = new FundingCoordinator(
      initial.ledger,
      {
        ...initial.effects,
        sweep: async () => {
          replayCalls += 1;
          return { ok: true, recoveredAmount: 100, residualAmount: 0, fees: 0 };
        },
      },
      { assertReady: () => {} }
    );
    const quarantined = resumed.quarantineForResume('leg-uncertain-sweep');
    if (quarantined.state !== 'quarantined') throw new Error('expected quarantined resume');

    await expect(resumed.sweep(quarantined)).rejects.toThrow(/lease is already held/);
    expect(replayCalls).toBe(0);
    expect(auditStartupLiabilities(initial.base).blockers).toContainEqual(
      expect.objectContaining({
        status: 'effect-lease',
        crashWindow: 'value-effect-outcome-uncertain',
      })
    );
  });
});
