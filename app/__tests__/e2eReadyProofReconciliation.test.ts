import { Amount, CheckStateEnum } from '@cashu/cashu-ts';
import type { CoreProof, Manager } from '@cashu/coco-core';

import {
  parseE2EReadyProofAssets,
  serializeE2EReadyProofAssets,
} from '@/shared/lib/cashu/e2eProofReconciliationConfig';
import { reconcileE2EReadyProofs } from '@/shared/lib/cashu/e2eReadyProofReconciliation';
import {
  getE2EReadyProofStatus,
  parseE2EReadyProofStatus,
  serializeE2EReadyProofStatus,
} from '@/shared/lib/cashu/e2eReadyProofStatus';

const MINT = 'https://mint.example';

function proof(secret: string, amount: number): CoreProof {
  return {
    id: '00test',
    amount: Amount.from(amount),
    secret,
    C: `02${'11'.repeat(32)}`,
    mintUrl: MINT,
    unit: 'sat',
    state: 'ready',
  };
}

function managerWith(
  proofs: CoreProof[],
  states: { state: CheckStateEnum }[]
): {
  manager: Manager;
  checkProofsStates: jest.Mock;
  setProofState: jest.Mock;
} {
  const checkProofsStates = jest.fn(async () => states);
  const setProofState = jest.fn(async () => {});
  return {
    manager: {
      proofService: {
        getReadyProofs: jest.fn(async () => proofs),
        setProofState,
      },
      walletService: {
        getWallet: jest.fn(async () => ({ checkProofsStates })),
      },
    } as unknown as Manager,
    checkProofsStates,
    setProofState,
  };
}

describe('funded E2E ready-proof reconciliation', () => {
  it('uses compact, exact, normalized funded-asset config', () => {
    const raw = serializeE2EReadyProofAssets([{ mintUrl: `${MINT}/`, unit: 'SAT' }]);
    expect(raw).toBe(JSON.stringify(JSON.parse(raw)));
    expect(parseE2EReadyProofAssets(raw)).toEqual([{ mintUrl: MINT, unit: 'sat' }]);
    expect(() =>
      parseE2EReadyProofAssets(
        JSON.stringify({ version: 1, assets: [{ mintUrl: 'http://mint.example', unit: 'sat' }] })
      )
    ).toThrow(/HTTPS/);
  });

  it('marks only mint-proven SPENT proofs and exposes only non-secret totals', async () => {
    const proofs = [
      proof('secret-spent', 32),
      proof('secret-pending', 8),
      proof('secret-ready', 4),
    ];
    const context = managerWith(proofs, [
      { state: CheckStateEnum.SPENT },
      { state: CheckStateEnum.PENDING },
      { state: CheckStateEnum.UNSPENT },
    ]);

    const result = await reconcileE2EReadyProofs(
      context.manager,
      serializeE2EReadyProofAssets([{ mintUrl: MINT, unit: 'sat' }])
    );

    expect(context.checkProofsStates).toHaveBeenCalledWith(proofs);
    expect(context.setProofState).toHaveBeenCalledWith(MINT, ['secret-spent'], 'spent');
    expect(result).toEqual({
      assets: 1,
      checked: 3,
      spent: 1,
      pending: 1,
      unspent: 1,
      remaining: [{ mintUrl: MINT, unit: 'sat', amount: 12 }],
    });
    const rawStatus = serializeE2EReadyProofStatus(getE2EReadyProofStatus());
    expect(parseE2EReadyProofStatus(rawStatus)).toMatchObject({
      phase: 'complete',
      checked: 3,
      spent: 1,
      remaining: [{ mintUrl: MINT, unit: 'sat', amount: 12 }],
    });
    expect(rawStatus).not.toContain('secret-');
  });

  it('fails closed on malformed mint state responses without changing proof rows', async () => {
    const context = managerWith([proof('never-log-this-secret', 32)], []);
    await expect(
      reconcileE2EReadyProofs(
        context.manager,
        serializeE2EReadyProofAssets([{ mintUrl: MINT, unit: 'sat' }])
      )
    ).rejects.toThrow(/invalid E2E ready-proof state response/);
    expect(context.setProofState).not.toHaveBeenCalled();
    expect(getE2EReadyProofStatus()).toMatchObject({ phase: 'failed', remaining: [] });
    expect(serializeE2EReadyProofStatus(getE2EReadyProofStatus())).not.toContain(
      'never-log-this-secret'
    );
  });
});
