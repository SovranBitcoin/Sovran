/**
 * Generic multi-leg progress store factory.
 *
 * A long-running action is modelled as a sequence of N legs, each flipping
 * pending → active → done | failed | skipped, with a terminal action state of
 * running → done | failed | cancelled | unsettled (`LEG_MOVES` and `end`
 * below refuse every other move). `unsettled` means the run
 * stopped with an outcome that is not yet known (a payment still in flight):
 * it is never reported as a failure. The unified Swap toast and the post
 * Delete toast both drive their progress through a store built from this
 * factory — the leg state machine lives here once, the domain-specific toast
 * surfaces (text vs. segmented ring) stay separate.
 *
 * Each call to `createLegProgressStore` returns an independent singleton store
 * so two domains (e.g. a swap and a delete) never collide on a single `active`.
 *
 * Not persisted — progress is per-session and tied to in-memory orchestrators.
 */

import { defineStore as create } from '@/shared/lib/persist/defineStore';

type LegLogger = {
  info: (message: string, fields?: Record<string, unknown>) => void;
  warn: (message: string, fields?: Record<string, unknown>) => void;
  debug: (message: string, fields?: Record<string, unknown>) => void;
};

export type LegStatus = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

export type ProgressState = 'running' | 'done' | 'failed' | 'cancelled' | 'unsettled';

/** A leg's error belongs to its failure: no other status carries one. */
export type ProgressLeg = {
  id: string;
  /** Optional human label, e.g. "Mint A → Mint B" or "relay.example.com". */
  label?: string;
} & (
  | { status: Exclude<LegStatus, 'failed'>; errorMessage?: undefined }
  | { status: 'failed'; errorMessage?: string }
);

/**
 * What a leg can become next. Done and skipped are final; a failed leg can be
 * tried again (active), succeed on a retry, fail again or be skipped.
 */
const LEG_MOVES: Record<LegStatus, readonly LegStatus[]> = {
  pending: ['active', 'done', 'failed', 'skipped'],
  active: ['done', 'failed', 'skipped'],
  failed: ['active', 'done', 'failed', 'skipped'],
  done: [],
  skipped: [],
};

/**
 * The run's own state. It ends once: a final state is never replaced by
 * another, only reopened by `resume` for a retry. The message is the failure
 * text, the cancel reason or what is still pending.
 */
type RunState =
  | { state: 'running' | 'done'; errorMessage?: undefined }
  | { state: 'failed' | 'cancelled' | 'unsettled'; errorMessage?: string };

type ActiveProgress<Meta> = RunState & {
  /** Stable id used to correlate updates with the toast. */
  id: string;
  startedAt: number;
  legs: ProgressLeg[];
  /** Domain payload (swap: unit/totalAmount/groupId; delete: noteId). */
  meta: Meta;
};

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
  /** End the run with an outcome that is still unknown (e.g. a melt that has
   *  not settled); `detail` says what is still pending. */
  settleUnknown: (detail?: string) => void;
  /** Reopen a run that ended, for a retry of its legs; no-op while running. */
  resume: () => void;
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

  return create<LegProgressStore<Meta>>({ name: 'legProgress', scope: 'session' })((set, get) => {
    const setLeg = (legId: string, next: Pick<ProgressLeg, 'status' | 'errorMessage'>) =>
      set((s) => {
        if (!s.active) return s;
        let moved = false;
        const legs = s.active.legs.map((leg): ProgressLeg => {
          if (leg.id !== legId) return leg;
          if (!LEG_MOVES[leg.status].includes(next.status)) {
            log.debug(`${name}.status.leg_move_refused`, {
              legId,
              from: leg.status,
              to: next.status,
            });
            return leg;
          }
          moved = true;
          const base = { id: leg.id, ...(leg.label !== undefined ? { label: leg.label } : {}) };
          return next.status === 'failed'
            ? { ...base, status: 'failed', errorMessage: next.errorMessage }
            : { ...base, status: next.status };
        });
        return moved ? { active: { ...s.active, legs } } : s;
      });

    /** End a running run; a run that already ended keeps its end. */
    const end = (next: RunState, logEnd: (active: ActiveProgress<Meta>) => void) => {
      const cur = get().active;
      if (!cur) return;
      if (cur.state !== 'running') {
        log.warn(`${name}.status.end_refused`, { id: cur.id, state: cur.state, next: next.state });
        return;
      }
      logEnd(cur);
      set({ active: { ...cur, ...next } });
    };

    // complete and cancel report the same thing — how long the run took and how
    // far the legs actually got — and differ only in the state they land on.
    // `fail` deliberately stays separate: it logs at warn, and the leg tallies
    // are noise beside the error text.
    const logSettled = (event: 'complete' | 'cancel', active: ActiveProgress<Meta>) =>
      log.info(`${name}.status.${event}`, {
        id: active.id,
        durationMs: Date.now() - active.startedAt,
        doneLegs: active.legs.filter((l) => l.status === 'done').length,
        totalLegs: active.legs.length,
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
      setActiveLeg: (legId) => setLeg(legId, { status: 'active' }),
      setLegDone: (legId) => setLeg(legId, { status: 'done' }),
      setLegSkipped: (legId) => setLeg(legId, { status: 'skipped' }),
      setLegFailed: (legId, errorMessage) => setLeg(legId, { status: 'failed', errorMessage }),
      complete: () => end({ state: 'done' }, (cur) => logSettled('complete', cur)),
      fail: (errorMessage) =>
        end({ state: 'failed', errorMessage }, (cur) =>
          log.warn(`${name}.status.fail`, {
            id: cur.id,
            durationMs: Date.now() - cur.startedAt,
            errorMessage,
          })
        ),
      cancel: (errorMessage) =>
        end({ state: 'cancelled', errorMessage }, (cur) => logSettled('cancel', cur)),
      settleUnknown: (detail) =>
        end({ state: 'unsettled', errorMessage: detail }, (cur) =>
          log.info(`${name}.status.unsettled`, {
            id: cur.id,
            durationMs: Date.now() - cur.startedAt,
            doneLegs: cur.legs.filter((l) => l.status === 'done').length,
            totalLegs: cur.legs.length,
          })
        ),
      resume: () => {
        const cur = get().active;
        if (!cur || cur.state === 'running') return;
        log.info(`${name}.status.resume`, { id: cur.id, from: cur.state });
        set({ active: { ...cur, state: 'running', errorMessage: undefined } });
      },
      clear: () => {
        if (get().active) log.debug(`${name}.status.clear`);
        set({ active: null });
      },
    };
  });
}
