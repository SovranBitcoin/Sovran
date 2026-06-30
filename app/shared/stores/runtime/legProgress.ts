/**
 * Generic multi-leg progress store factory.
 *
 * A long-running action is modelled as a sequence of N legs, each flipping
 * pending → active → done | failed | skipped, with a terminal action state of
 * running → done | failed | cancelled. The unified Swap toast and the post
 * Delete toast both drive their progress through a store built from this
 * factory — the leg state machine lives here once, the domain-specific toast
 * surfaces (text vs. segmented ring) stay separate.
 *
 * Each call to `createLegProgressStore` returns an independent singleton store
 * so two domains (e.g. a swap and a delete) never collide on a single `active`.
 *
 * Not persisted — progress is per-session and tied to in-memory orchestrators.
 */

import { create } from 'zustand';

type LegLogger = {
  info: (message: string, fields?: Record<string, unknown>) => void;
  warn: (message: string, fields?: Record<string, unknown>) => void;
  debug: (message: string, fields?: Record<string, unknown>) => void;
};

export type LegStatus = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

export type ProgressState = 'running' | 'done' | 'failed' | 'cancelled';

export interface ProgressLeg {
  id: string;
  /** Optional human label, e.g. "Mint A → Mint B" or "relay.example.com". */
  label?: string;
  status: LegStatus;
  errorMessage?: string;
}

interface ActiveProgress<Meta> {
  /** Stable id used to correlate updates with the toast. */
  id: string;
  startedAt: number;
  state: ProgressState;
  legs: ProgressLeg[];
  /** Last failure text, set when state flips to 'failed'. */
  errorMessage?: string;
  /** Domain payload (swap: unit/totalAmount/groupId; delete: noteId). */
  meta: Meta;
}

interface LegProgressStore<Meta> {
  active: ActiveProgress<Meta> | null;
  start: (params: { id: string; legs: { id: string; label?: string }[]; meta: Meta }) => void;
  setActiveLeg: (legId: string) => void;
  setLegDone: (legId: string) => void;
  setLegSkipped: (legId: string) => void;
  setLegFailed: (legId: string, errorMessage?: string) => void;
  complete: () => void;
  fail: (errorMessage?: string) => void;
  cancel: (errorMessage?: string) => void;
  /** Clear without firing terminal logs — used when the toast auto-dismisses. */
  clear: () => void;
}

/**
 * Build a singleton leg-progress store. `name` is the log-event prefix
 * (`<name>.status.start` etc.), `log` the scoped logger to emit through.
 */
export function createLegProgressStore<Meta extends object>(opts: {
  name: string;
  log: LegLogger;
}) {
  const { name, log } = opts;

  return create<LegProgressStore<Meta>>((set, get) => {
    const setLeg = (legId: string, status: LegStatus, errorMessage?: string) =>
      set((s) => {
        if (!s.active) return s;
        const legs = s.active.legs.map((l) =>
          l.id === legId
            ? { ...l, status, ...(errorMessage !== undefined ? { errorMessage } : {}) }
            : l
        );
        return { active: { ...s.active, legs } };
      });

    return {
      active: null,
      start: ({ id, legs, meta }) => {
        log.info(`${name}.status.start`, {
          id,
          legCount: legs.length,
          ...(meta as Record<string, unknown>),
        });
        set({
          active: {
            id,
            startedAt: Date.now(),
            state: 'running',
            legs: legs.map((l) => ({ ...l, status: 'pending' as const })),
            meta,
          },
        });
      },
      setActiveLeg: (legId) => setLeg(legId, 'active'),
      setLegDone: (legId) => setLeg(legId, 'done'),
      setLegSkipped: (legId) => setLeg(legId, 'skipped'),
      setLegFailed: (legId, errorMessage) => setLeg(legId, 'failed', errorMessage),
      complete: () => {
        const cur = get().active;
        if (!cur) return;
        log.info(`${name}.status.complete`, {
          id: cur.id,
          durationMs: Date.now() - cur.startedAt,
          doneLegs: cur.legs.filter((l) => l.status === 'done').length,
          totalLegs: cur.legs.length,
        });
        set({ active: { ...cur, state: 'done' } });
      },
      fail: (errorMessage) => {
        const cur = get().active;
        if (!cur) return;
        log.warn(`${name}.status.fail`, {
          id: cur.id,
          durationMs: Date.now() - cur.startedAt,
          errorMessage,
        });
        set({ active: { ...cur, state: 'failed', errorMessage } });
      },
      cancel: (errorMessage) => {
        const cur = get().active;
        if (!cur) return;
        log.info(`${name}.status.cancel`, {
          id: cur.id,
          durationMs: Date.now() - cur.startedAt,
          doneLegs: cur.legs.filter((l) => l.status === 'done').length,
          totalLegs: cur.legs.length,
        });
        set({ active: { ...cur, state: 'cancelled', errorMessage } });
      },
      clear: () => {
        if (get().active) log.debug(`${name}.status.clear`);
        set({ active: null });
      },
    };
  });
}
