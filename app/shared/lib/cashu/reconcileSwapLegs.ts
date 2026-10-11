import { cashuLog, redactError } from '@/shared/lib/logger';
import {
  useSwapTransactionsStore,
  type SwapLeg,
} from '@/shared/stores/profile/swapTransactionsStore';

/** What a leg's own Coco operation looks like, as far as this needs to know. */
interface OperationSnapshot {
  state: string;
  error?: string | null;
}

interface SwapLegOperations {
  ops: {
    mint: { get(operationId: string): Promise<OperationSnapshot | null> };
    melt: { get(operationId: string): Promise<OperationSnapshot | null> };
  };
}

const MELT_ROLLED_BACK = 'The payment did not go through. The funds are back in the sending mint.';

/**
 * Move saved swap legs that ended without a known outcome to their final
 * state, from Coco's record of each leg's own operations:
 *
 * - `paymentPending` (the melt was sent, its outcome unknown) becomes
 *   `settling` once the melt is finalized, or `failed` once it is rolled back.
 * - `settling` (the melt was paid, the destination had not issued) becomes
 *   `done` once this leg's mint operation is finalized without an error.
 *
 * Anything else stays as it is: a leg is never called done because time has
 * passed, and a mint operation that failed after its melt was paid is money
 * still outstanding, not a failed swap.
 */
export async function reconcileSwapLegs(manager: SwapLegOperations): Promise<void> {
  const unsettled: { groupId: string; leg: SwapLeg }[] = [];
  for (const group of Object.values(useSwapTransactionsStore.getState().groups)) {
    for (const leg of group.legs) {
      if (leg.localStatus === 'settling' || leg.localStatus === 'paymentPending') {
        unsettled.push({ groupId: group.id, leg });
      }
    }
  }

  for (const { groupId, leg } of unsettled) {
    try {
      const setStatus = useSwapTransactionsStore.getState().setLegStatus;
      let status = leg.localStatus;
      if (status === 'paymentPending' && leg.meltOperationId) {
        const melt = await manager.ops.melt.get(leg.meltOperationId);
        if (melt?.state === 'rolled_back') {
          setStatus(groupId, leg.id, { localStatus: 'failed', errorMessage: MELT_ROLLED_BACK });
          continue;
        }
        if (melt?.state !== 'finalized') continue;
        status = 'settling';
        setStatus(groupId, leg.id, { localStatus: 'settling' });
      }
      if (status === 'settling' && leg.mintOperationId) {
        const mint = await manager.ops.mint.get(leg.mintOperationId);
        if (mint?.state === 'finalized' && !mint.error) {
          setStatus(groupId, leg.id, { localStatus: 'done' });
        }
      }
    } catch (error) {
      // A read is idempotent; the next run tries this leg again.
      cashuLog.warn('swap.reconcile.read_failed', { legId: leg.id, error: redactError(error) });
    }
  }
}
