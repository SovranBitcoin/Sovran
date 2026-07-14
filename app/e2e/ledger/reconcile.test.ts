import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FundingCoordinator, type FundingEffects } from './coordinator';
import { storeRecovery } from './custody';
import { RunLedger, type AssetLocation } from './ledger';
import { reconcileLiability } from './reconcile';

const asset: AssetLocation = {
  mintUrl: 'https://mint.cubabitcoin.org',
  unit: 'usd',
  accountIndex: 2,
};

describe('reconcileLiability', () => {
  it('delegates the exact-asset sweep to FundingCoordinator before reconciliation', async () => {
    const base = mkdtempSync(join(tmpdir(), 'e2e-reconcile-'));
    const custody = storeRecovery(base, 'mnemonic', 'test recovery material');
    const ledger = new RunLedger(base, 'run-reconcile', () => 1);
    const requests: unknown[] = [];
    const effects: FundingEffects = {
      fund: async () => ({ amount: 100, fees: 0 }),
      outflow: async ({ amount }) => ({ amount, fees: 0 }),
      sweep: async (request) => {
        requests.push(request);
        return { ok: true, recoveredAmount: 100, residualAmount: 0, fees: 0 };
      },
    };
    const coordinator = new FundingCoordinator(ledger, effects, { assertReady: () => {} });
    const intent = coordinator.prepareFunding({
      legId: 'leg-usd',
      custody,
      counterparty: 'cocod-test-wallet',
      asset,
      expectedAmount: 100,
    });
    const funded = await coordinator.fund(intent);

    const reconciled = await reconcileLiability(coordinator, funded);

    expect(requests).toEqual([
      {
        runId: 'run-reconcile',
        legId: 'leg-usd',
        asset,
        custody,
      },
    ]);
    expect(reconciled.state).toBe('reconciled');
    expect(ledger.status().get('leg-usd')).toBe('reconciled');
  });
});
