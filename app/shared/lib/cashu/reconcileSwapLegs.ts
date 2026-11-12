import { meltNeverSent, meltSettledUnpaid } from 'wallet';

import { cashuLog, redactError } from '@/shared/lib/logger';
import { legMoneyMayMove, swapGroupPhase } from '@/shared/lib/cashu/swapGroupPhase';
import {
  useSwapTransactionsStore,
  type SwapLeg,
  type SwapLegStatusUpdate,
} from '@/shared/stores/profile/swapTransactionsStore';

/** What a leg's own Coco operation looks like, as far as this needs to know. */
interface OperationSnapshot {
  state: string;
  error?: string | null;
}

interface SwapLegOperations {
  ops: {
    mint: { get(operationId: string): Promise<OperationSnapshot | null> };
    melt: {
      get(operationId: string): Promise<OperationSnapshot | null>;
      /** Rolls a melt that was never sent back under its operation lock; throws once it may have been. */
      cancel(operationId: string, reason?: string): Promise<void>;
    };
  };
}

const MELT_ROLLED_BACK = 'The payment did not go through. The funds are back in the sending mint.';

/**
 * Move saved swap legs that ended without a known outcome to their final
 * state, from Coco's record of each leg's own operations:
 *
 * - A leg whose melt Coco settled unpaid (rolled back, or failed with its
 *   inputs given back) is `failed`, whatever it said before. So is a
 *   `paymentPending` leg whose melt was never sent, once Coco has cancelled
 *   that melt: the engine gave up on it unsent, but its ecash stays reserved,
 *   and a call that still holds it could send it, until it is cancelled. A
 *   melt Coco will not cancel leaves the leg as it is. Before that point a
 *   run that was cancelled may still send a prepared melt, so it proves
 *   nothing.
 * - `paymentPending` (the melt was sent, its outcome unknown), and a leg a
 *   run that is gone left at `melting`, `verifying` or `invoiceReady` with a
 *   melt, becomes `settling` once the melt is finalized.
 * - `settling` (the melt was paid, the destination had not issued) becomes
 *   `done` once this leg's mint operation is finalized without an error.
 *
 * Anything else stays as it is: a leg is never called done because time has
 * passed, and a mint operation that failed after its melt was paid is money
 * still outstanding, not a failed swap.
 *
 * A group saved as running that no run owns (`interrupted`) is then ended
 * once no leg's money may still move: `finished` when every leg reached an outcome,
 * `cancelled` when one stopped before it sent anything.
 *
 * Nothing is written once `isCurrent` says this pass has been replaced.
 * Resolves true when a write was refused because its leg changed while its
 * operation was read: what was read no longer applies, and the leg as it is
 * now has not been looked at.
 */
export async function reconcileSwapLegs(
  manager: SwapLegOperations,
  isCurrent: () => boolean = () => true
): Promise<boolean> {
  let legChangedWhileRead = false;
  const unsettled: { groupId: string; leg: SwapLeg }[] = [];
  const interrupted: string[] = [];
  for (const group of Object.values(useSwapTransactionsStore.getState().groups)) {
    const phase = swapGroupPhase(group);
    if (phase === 'interrupted') interrupted.push(group.id);
    // A live run settles its own legs in flight; nothing else will.
    const runGone = phase !== 'running';
    for (const leg of group.legs) {
      const outcomeUnknown = leg.localStatus === 'settling' || leg.localStatus === 'paymentPending';
      if (outcomeUnknown || (runGone && legMoneyMayMove(leg))) {
        unsettled.push({ groupId: group.id, leg });
      }
    }
  }

  for (const { groupId, leg } of unsettled) {
    try {
      let status = leg.localStatus;
      /**
       * Act only while the leg is still the attempt this pass read: the
       * same status and the same operations. A retry can prepare a new melt
       * or mint and keep, or come back to, the same status.
       */
      const stillRead = () => {
        if (!isCurrent()) return false;
        const current = useSwapTransactionsStore
          .getState()
          .groups[groupId]?.legs.find((saved) => saved.id === leg.id);
        if (
          !current ||
          current.localStatus !== status ||
          current.meltOperationId !== leg.meltOperationId ||
          current.mintOperationId !== leg.mintOperationId
        ) {
          legChangedWhileRead = true;
          return false;
        }
        return true;
      };
      const move = (update: SwapLegStatusUpdate) => {
        if (!stillRead()) return false;
        useSwapTransactionsStore.getState().setLegStatus(groupId, leg.id, update);
        status = update.localStatus;
        return true;
      };

      if (leg.meltOperationId) {
        const melt = await manager.ops.melt.get(leg.meltOperationId);
        if (melt && meltSettledUnpaid(melt.state)) {
          move({ localStatus: 'failed', errorMessage: MELT_ROLLED_BACK });
          continue;
        }
        if (melt && status === 'paymentPending' && meltNeverSent(melt.state)) {
          if (!stillRead()) continue;
          // Throws when Coco will not cancel it; the leg is then left for the next pass.
          await manager.ops.melt.cancel(
            leg.meltOperationId,
            'Swap leg given up before it was sent'
          );
          move({ localStatus: 'failed', errorMessage: MELT_ROLLED_BACK });
          continue;
        }
        if (status !== 'settling') {
          if (melt?.state !== 'finalized' || !move({ localStatus: 'settling' })) continue;
        }
      }
      if (status === 'settling' && leg.mintOperationId) {
        const mint = await manager.ops.mint.get(leg.mintOperationId);
        if (mint?.state === 'finalized' && !mint.error) move({ localStatus: 'done' });
      }
    } catch (error) {
      // A read, and a cancel Coco refused, change nothing; the next run tries this leg again.
      cashuLog.warn('swap.reconcile.read_failed', { legId: leg.id, error: redactError(error) });
    }
  }

  if (!isCurrent()) return legChangedWhileRead;
  for (const groupId of interrupted) endInterruptedGroup(groupId);
  return legChangedWhileRead;
}

/** End an interrupted group once no leg's money may still move, as its legs prove it went. */
function endInterruptedGroup(groupId: string): void {
  const store = useSwapTransactionsStore.getState();
  const group = store.groups[groupId];
  // Read again: a run may have taken the group up while operations were read.
  if (!group || swapGroupPhase(group) !== 'interrupted' || group.legs.some(legMoneyMayMove)) return;
  const reachedOutcome = group.legs.every(
    (leg) => leg.localStatus === 'done' || leg.localStatus === 'failed'
  );
  const end = group.legs.length > 0 && reachedOutcome ? 'finished' : 'cancelled';
  cashuLog.info('swap.reconcile.end_interrupted', { groupId, end, legs: group.legs.length });
  store.finalizeGroup(groupId, end);
}

/**
 * Runs `reconcileSwapLegs` one pass at a time. A request that lands during a
 * pass asks for one more instead of starting its own, so a burst of operation
 * events costs two passes, not one each. A pass that read a leg which then
 * changed asks for one more as well, once, so the leg as it is now is read
 * without waiting for the next event. Once stopped it writes nothing,
 * including from a pass that was reading when it stopped.
 */
export function createSwapLegReconciler(manager: SwapLegOperations) {
  let active = true;
  let running = false;
  let again = false;
  const pass = async () => {
    running = true;
    let rereadChangedLeg = true;
    try {
      do {
        again = false;
        const legChanged = await reconcileSwapLegs(manager, () => active);
        if (legChanged && rereadChangedLeg) {
          rereadChangedLeg = false;
          again = true;
        }
      } while (again && active);
    } catch (error) {
      cashuLog.warn('swap.reconcile.failed', { error: redactError(error) });
    }
    running = false;
  };
  return {
    run: () => {
      if (!active) return;
      if (running) again = true;
      else void pass();
    },
    stop: () => {
      active = false;
    },
  };
}
