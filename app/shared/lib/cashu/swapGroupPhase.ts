import { estimatedTransferFee } from '@/features/mint/components/rebalance/transferFee';
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

/** The transfer a leg was made for: its chain's ends, or its own. */
function transferOf(leg: Pick<SwapLeg, 'fromMintUrl' | 'toMintUrl' | 'chainPath'>) {
  const path = leg.chainPath;
  return path && path.length >= 2
    ? { from: path[0], to: path[path.length - 1] }
    : { from: leg.fromMintUrl, to: leg.toMintUrl };
}

/**
 * Whether `amount` is what a route carried for a transfer of `wanted`, over
 * `hops` transfers: each may have cost up to the fee the planner budgets for
 * one, and the engine shrinks a transfer to what its source can pay after fees.
 */
function carries(amount: number, wanted: number, hops: number): boolean {
  return amount >= wanted - hops * estimatedTransferFee(wanted);
}

/**
 * Whether a later route through other mints delivered, in place of `failed`,
 * the transfer it was made for. The engine saves a reroute as a chain of hops
 * between the same two mints, after the attempt it replaces (a retry reuses
 * its leg instead). The saved legs carry no plan step, so a route is tied to
 * the failed attempt by its ends, by coming later, and by its amount: its
 * first hop set out with the failed attempt's amount and its last hop, done,
 * delivered it, less fees. Anything less leaves the failure standing. A direct
 * leg never replaces another: two plan steps can share their mints.
 */
function replacedLater(legs: readonly SwapLeg[], index: number): boolean {
  const failed = legs[index];
  const wanted = transferOf(failed);
  const later = legs.slice(index + 1);
  return later.some((last) => {
    const path = last.chainPath;
    if (last.localStatus !== 'done' || !last.chainId || !path || path.length < 3) return false;
    if (last.chainId === failed.chainId || last.toMintUrl !== path[path.length - 1]) return false;
    const delivered = transferOf(last);
    if (delivered.from !== wanted.from || delivered.to !== wanted.to) return false;
    const first = later.find((leg) => leg.chainId === last.chainId && leg.chainHopIndex === 0);
    return (
      !!first &&
      carries(first.amount, failed.amount, 1) &&
      carries(last.amount, failed.amount, path.length - 1)
    );
  });
}

/** A failed leg that no later attempt replaced. */
function failedOutstanding(legs: readonly SwapLeg[]): boolean {
  return legs.some((leg, index) => leg.localStatus === 'failed' && !replacedLater(legs, index));
}

/**
 * What a saved group shows the person, in this order:
 *
 * - `inProgress` while a run owns it, it was interrupted, or any leg's money
 *   may still move, whatever the group was saved as. A run that ended (an
 *   abort, Cancel) can leave a leg mid-payment, and one failed leg says nothing
 *   about another that is still moving.
 * - `failed` once nothing can still move and a leg failed that no later
 *   route delivered in its place.
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
      return failedOutstanding(group.legs) ? 'failed' : phase;
    default: {
      const exhaustive: never = phase;
      return exhaustive;
    }
  }
}
