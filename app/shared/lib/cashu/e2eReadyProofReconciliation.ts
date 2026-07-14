import { CheckStateEnum } from '@cashu/cashu-ts';
import type { CoreProof, Manager } from '@cashu/coco-core';

import { parseE2EReadyProofAssets } from './e2eProofReconciliationConfig';
import { getReadyProofs, getWallet, markProofsSpent } from './managerInternals';
import {
  publishE2EReadyProofStatus,
  type E2EReadyProofRemainingAsset,
} from './e2eReadyProofStatus';

export interface E2EReadyProofReconciliationResult {
  assets: number;
  checked: number;
  spent: number;
  pending: number;
  unspent: number;
  remaining: E2EReadyProofRemainingAsset[];
}

function proofUnit(proof: CoreProof): string {
  return (proof.unit || 'sat').trim().toLowerCase();
}

/**
 * Refreshes only the ready proofs for the exact funded assets declared by the
 * owned simulator session. The mint remains the source of truth: only SPENT
 * responses are persisted, PENDING stays ready for a later check, and malformed
 * responses fail closed. No proof, secret, or token is logged or returned.
 */
export async function reconcileE2EReadyProofs(
  manager: Manager,
  rawConfig: string
): Promise<E2EReadyProofReconciliationResult> {
  const assets = parseE2EReadyProofAssets(rawConfig);
  publishE2EReadyProofStatus({
    version: 1,
    phase: 'running',
    assets: assets.length,
    checked: 0,
    spent: 0,
    remaining: [],
  });
  const result: E2EReadyProofReconciliationResult = {
    assets: assets.length,
    checked: 0,
    spent: 0,
    pending: 0,
    unspent: 0,
    remaining: [],
  };
  try {
    for (const asset of assets) {
      const proofs = (await getReadyProofs(manager, asset.mintUrl)).filter(
        (proof) => proofUnit(proof) === asset.unit
      );
      const wallet = proofs.length
        ? await getWallet(manager, asset.mintUrl, asset.unit)
        : undefined;
      const states = wallet ? await wallet.checkProofsStates(proofs) : [];
      if (!Array.isArray(states) || states.length !== proofs.length) {
        throw new Error('mint returned an invalid E2E ready-proof state response');
      }

      const spentSecrets: string[] = [];
      let remainingAmount = 0;
      for (let index = 0; index < states.length; index++) {
        const state = states[index]?.state;
        if (state === CheckStateEnum.SPENT) spentSecrets.push(proofs[index].secret);
        else if (state === CheckStateEnum.PENDING) {
          result.pending++;
          remainingAmount += proofs[index].amount.toNumber();
        } else if (state === CheckStateEnum.UNSPENT) {
          result.unspent++;
          remainingAmount += proofs[index].amount.toNumber();
        } else throw new Error('mint returned an unknown E2E ready-proof state');
        if (!Number.isSafeInteger(remainingAmount) || remainingAmount < 0) {
          throw new Error('E2E ready-proof remaining amount is outside the safe range');
        }
      }
      result.checked += proofs.length;
      result.spent += spentSecrets.length;
      result.remaining.push({ ...asset, amount: remainingAmount });
      await markProofsSpent(manager, asset.mintUrl, spentSecrets);
    }
    publishE2EReadyProofStatus({
      version: 1,
      phase: 'complete',
      assets: result.assets,
      checked: result.checked,
      spent: result.spent,
      remaining: result.remaining,
    });
    return result;
  } catch (error) {
    publishE2EReadyProofStatus({
      version: 1,
      phase: 'failed',
      assets: assets.length,
      checked: result.checked,
      spent: result.spent,
      remaining: [],
    });
    throw error;
  }
}
