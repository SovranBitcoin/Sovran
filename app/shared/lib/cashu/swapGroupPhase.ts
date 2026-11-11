import type { SwapGroup } from '@/shared/stores/profile/swapTransactionsStore';

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
export type SwapGroupPhase = 'running' | 'interrupted' | 'finished' | 'cancelled';

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

export function swapGroupPhase(group: Pick<SwapGroup, 'id' | 'state'>): SwapGroupPhase {
  switch (group.state) {
    case 'running':
      return owners.has(group.id) ? 'running' : 'interrupted';
    case 'finished':
    case 'cancelled':
      return group.state;
  }
}
