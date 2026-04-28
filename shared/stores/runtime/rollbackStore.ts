import { create } from 'zustand';

// Two-phase rollback state, kept out of React props so per-row spinner /
// collapse changes don't bust the surrounding list memo.
//
//   inFlight   — reclaim RPC is running; row icon shows the spinner.
//   collapsing — reclaim succeeded; row should remain rendered as a "ghost"
//                in the Pending bucket while it plays its height-collapse
//                animation, so the list virtualizer can't unmount the row
//                before Reanimated finishes the exit.
//
// Failed reclaims skip `collapsing` entirely — the row stays as a normal
// pending entry.
//
// Both the row's height collapse and the LegendList sibling reflow are
// driven from the same linear timing curve so they read as one continuous
// rigid motion — no spring, no overshoot, no bounce. Hold the row in the
// bucket until the timing curve has finished.
export const COLLAPSE_DURATION_MS = 260;
const COLLAPSE_HOLD_MS = COLLAPSE_DURATION_MS + 20;

interface RollbackStore {
  inFlight: Set<string>;
  collapsing: Set<string>;
  start: (operationId: string) => void;
  succeed: (operationId: string) => void;
  fail: (operationId: string) => void;
}

const without = <T>(set: Set<T>, value: T): Set<T> => {
  if (!set.has(value)) return set;
  const next = new Set(set);
  next.delete(value);
  return next;
};

const withValue = <T>(set: Set<T>, value: T): Set<T> => {
  if (set.has(value)) return set;
  const next = new Set(set);
  next.add(value);
  return next;
};

export const useRollbackStore = create<RollbackStore>((set, get) => ({
  inFlight: new Set<string>(),
  collapsing: new Set<string>(),
  start: (operationId) => set((s) => ({ inFlight: withValue(s.inFlight, operationId) })),
  succeed: (operationId) => {
    set((s) => ({
      inFlight: without(s.inFlight, operationId),
      collapsing: withValue(s.collapsing, operationId),
    }));
    setTimeout(() => {
      const { collapsing } = get();
      if (!collapsing.has(operationId)) return;
      set((s) => ({ collapsing: without(s.collapsing, operationId) }));
    }, COLLAPSE_HOLD_MS);
  },
  fail: (operationId) => set((s) => ({ inFlight: without(s.inFlight, operationId) })),
}));

export const useIsReclaiming = (operationId: string) =>
  useRollbackStore((s) => s.inFlight.has(operationId));

export const useIsCollapsing = (operationId: string) =>
  useRollbackStore((s) => s.collapsing.has(operationId));
