import { cashuLog, redactError } from '@/shared/lib/logger';
import {
  useSwapTransactionsStore,
  type SwapLeg,
  type SwapLegLocalStatus,
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

/** Saved by a run that ended, or by an older build that had no value for an unknown outcome. */
const LEFT_MID_FLIGHT: ReadonlySet<SwapLegLocalStatus | undefined> = new Set([
  'melting',
  'verifying',
]);

/**
 * Move saved swap legs that ended without a known outcome to their final
 * state, from Coco's record of each leg's own operations:
 *
 * - A leg whose melt is rolled back is `failed`, whatever it said before.
 * - `paymentPending` (the melt was sent, its outcome unknown), and a leg a
 *   finished run left at `melting` or `verifying`, becomes `settling` once the
 *   melt is finalized.
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
      const stale = group.state !== 'running' && LEFT_MID_FLIGHT.has(leg.localStatus);
      if (leg.localStatus === 'settling' || leg.localStatus === 'paymentPending' || stale) {
        unsettled.push({ groupId: group.id, leg });
      }
    }
  }

  for (const { groupId, leg } of unsettled) {
    try {
      let status = leg.localStatus;
      /** Write only while the leg still says what this pass read. */
      const move = (localStatus: SwapLegLocalStatus, errorMessage?: string) => {
        const store = useSwapTransactionsStore.getState();
        const current = store.groups[groupId]?.legs.find((saved) => saved.id === leg.id);
        if (current?.localStatus !== status) return false;
        store.setLegStatus(groupId, leg.id, { localStatus, errorMessage });
        status = localStatus;
        return true;
      };

      if (leg.meltOperationId) {
        const melt = await manager.ops.melt.get(leg.meltOperationId);
        if (melt?.state === 'rolled_back') {
          move('failed', MELT_ROLLED_BACK);
          continue;
        }
        if (status !== 'settling') {
          if (melt?.state !== 'finalized' || !move('settling')) continue;
        }
      }
      if (status === 'settling' && leg.mintOperationId) {
        const mint = await manager.ops.mint.get(leg.mintOperationId);
        if (mint?.state === 'finalized' && !mint.error) move('done');
      }
    } catch (error) {
      // A read is idempotent; the next run tries this leg again.
      cashuLog.warn('swap.reconcile.read_failed', { legId: leg.id, error: redactError(error) });
    }
  }
}

/**
 * Runs `reconcileSwapLegs` one pass at a time. A request that lands during a
 * pass asks for one more instead of starting its own, so a burst of operation
 * events costs two passes, not one each.
 */
export function createSwapLegReconciler(manager: SwapLegOperations) {
  let active = true;
  let running = false;
  let again = false;
  const pass = async () => {
    running = true;
    try {
      do {
        again = false;
        await reconcileSwapLegs(manager);
      } while (again && active);
    } catch (error) {
      cashuLog.warn('swap.reconcile.failed', { error: redactError(error) });
    }
    running = false;
  };
  return {
    run: () => {
      if (running) again = true;
      else void pass();
    },
    stop: () => {
      active = false;
    },
  };
}
