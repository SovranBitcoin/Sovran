import type { SwapGroup, SwapLeg } from '@/shared/stores/profile/swapTransactionsStore';

/**
 * Where a saved swap group is, as read in this process:
 *
 * - `running`: saved as running, and a run in this process owns it.
 * - `interrupted`: saved as running with no run behind it. Runs live in
 *   memory only, so after the app was killed, or after a run that never
 *   reported its end, nothing will continue it: its legs are left for
 *   reconciliation against their own operations.
 * - `finished`: the run went through its steps.
 * - `cancelled`: the run was stopped before it got through them.
 *
 * `interrupted` is never saved: it is the saved `running` plus the absence
 * of an owner, decided here where the group is read.
 */
type SwapGroupPhase = 'running' | 'interrupted' | 'finished' | 'cancelled';

/** Group id → how many holds this process has on it. */
const owners = new Map<string, number>();

/**
 * Mark a swap group as owned by a live run until the returned release is
 * called. Releasing twice is harmless.
 */
export function holdSwapGroup(groupId: string): () => void {
  owners.set(groupId, (owners.get(groupId) ?? 0) + 1);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const remaining = (owners.get(groupId) ?? 1) - 1;
    if (remaining > 0) owners.set(groupId, remaining);
    else owners.delete(groupId);
  };
}

/** Whether a run in this process owns any swap group: one swap runs at a time. */
export function anySwapGroupHeld(): boolean {
  return owners.size > 0;
}

export function swapGroupPhase(group: Pick<SwapGroup, 'id' | 'state'>): SwapGroupPhase {
  switch (group.state) {
    case 'running':
      return owners.has(group.id) ? 'running' : 'interrupted';
    case 'finished':
    case 'cancelled':
      return group.state;
  }
}

/**
 * Whether this leg's money may still move: its melt may yet be sent or paid,
 * or its destination has not been seen to issue. A melt is prepared only once
 * the leg's invoice is ready, so a leg before that point sent nothing, and a
 * leg at `invoiceReady` (or saved with no status) has sent something only if
 * it has a melt.
 */
export function legMoneyMayMove(leg: Pick<SwapLeg, 'localStatus' | 'meltOperationId'>): boolean {
  switch (leg.localStatus) {
    case 'melting':
    case 'verifying':
    case 'paymentPending':
    case 'settling':
      return true;
    case undefined:
    case 'invoiceReady':
      return !!leg.meltOperationId;
    case 'pending':
    case 'creatingInvoice':
    case 'done':
    case 'failed':
      return false;
    default: {
      const exhaustive: never = leg.localStatus;
      return exhaustive;
    }
  }
}

/**
 * What a saved group shows the person, in this order:
 *
 * - `inProgress` while a run owns it, it was interrupted, or any leg's money
 *   may still move, whatever the group was saved as. A run that ended (an
 *   abort, Cancel) can leave a leg mid-payment, and one failed leg says nothing
 *   about another that is still moving.
 * - `failed` once nothing can still move and a leg failed.
 * - Otherwise how the run ended: `finished` or `cancelled`.
 *
 * The history row and the detail screen both read this, so they agree.
 */
export type SwapGroupOutcome = 'inProgress' | 'failed' | 'finished' | 'cancelled';

export function swapGroupOutcome(
  group: Pick<SwapGroup, 'id' | 'state' | 'legs'>
): SwapGroupOutcome {
  if (group.legs.some(legMoneyMayMove)) return 'inProgress';
  const phase = swapGroupPhase(group);
  switch (phase) {
    case 'running':
    case 'interrupted':
      return 'inProgress';
    case 'finished':
    case 'cancelled':
      return group.legs.some((leg) => leg.localStatus === 'failed') ? 'failed' : phase;
    default: {
      const exhaustive: never = phase;
      return exhaustive;
    }
  }
}
