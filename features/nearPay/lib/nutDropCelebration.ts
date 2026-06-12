/**
 * Pure state machine for the Nut Drop receive celebration — the full-screen
 * gold takeover that plays when a P2PK-locked drop finishes redeeming while
 * the radar is open. No timers, no store access: the hook observes strike
 * 'active' → 'success' transitions, dispatches events with explicit `now`
 * stamps, and schedules `phase-complete` for the choreography beats.
 *
 * Restraint rules live here (unit-tested), not in the animation code:
 * - one ceremony at a time; same-sender drops mid-ceremony coalesce into the
 *   displayed amount; other senders queue (cap 2 — overflow drops silently,
 *   the payment toast already carried the money truth);
 * - repeats inside the cooldown and anything played from the queue use the
 *   abbreviated hold (repeat-exposure fatigue);
 * - while gated (send flow active) requests defer, and only requests still
 *   inside the freshness window play once the gate lifts;
 * - `skip` (tap-anywhere, or a send starting) jumps straight to the return
 *   flight — the celebration never blocks an interaction.
 */

export type CelebrationPhase = 'idle' | 'centering' | 'held' | 'returning';

export interface CelebrationRequest {
  peerID: string;
  amount: number;
  unit: string;
  /** When the strike success was observed (UNIX ms) — freshness anchor. */
  firedAt: number;
  /** Abbreviated hold for queued / inside-cooldown repeats. */
  abbreviated: boolean;
}

export interface CelebrationState {
  phase: CelebrationPhase;
  current: CelebrationRequest | null;
  queue: CelebrationRequest[];
  gated: boolean;
  lastStartedAt: number | null;
  /**
   * Increments every time a ceremony starts (direct or popped from the
   * queue). Consecutive queued ceremonies never pass through 'idle', so the
   * overlay keys on this to get a fresh instance (and a fresh flight) per
   * ceremony.
   */
  ceremonyId: number;
}

export type CelebrationEvent =
  | { type: 'strike-success'; peerID: string; amount: number; unit: string; now: number }
  | { type: 'gate-changed'; gated: boolean; now: number }
  /**
   * `phase` is the phase the sender's timer was scheduled FOR — a stale
   * callback racing a skip/gate flip is ignored instead of fast-forwarding
   * whatever phase happens to be current.
   */
  | { type: 'phase-complete'; phase: CelebrationPhase; now: number }
  | { type: 'skip'; now: number }
  | { type: 'reset' };

export const CELEBRATION_QUEUE_CAP = 2;
/** Deferred requests older than this never play — stale ceremony is noise. */
export const CELEBRATION_FRESHNESS_MS = 8000;
/** Full-length holds are rationed; repeats inside this window abbreviate. */
export const CELEBRATION_COOLDOWN_MS = 30_000;

export const INITIAL_CELEBRATION_STATE: CelebrationState = {
  phase: 'idle',
  current: null,
  queue: [],
  gated: false,
  lastStartedAt: null,
  ceremonyId: 0,
};

function pruneFresh(queue: readonly CelebrationRequest[], now: number): CelebrationRequest[] {
  return queue.filter((request) => now - request.firedAt <= CELEBRATION_FRESHNESS_MS);
}

/** Pop the next fresh queued request into a playing ceremony, if allowed. */
function startNext(state: CelebrationState, now: number): CelebrationState {
  const fresh = pruneFresh(state.queue, now);
  if (state.gated || fresh.length === 0) {
    return { ...state, phase: 'idle', current: null, queue: fresh };
  }
  const [next, ...rest] = fresh;
  return {
    ...state,
    phase: 'centering',
    // Anything that had to wait plays the abbreviated hold.
    current: { ...next, abbreviated: true },
    queue: rest,
    lastStartedAt: now,
    ceremonyId: state.ceremonyId + 1,
  };
}

function enqueue(state: CelebrationState, request: CelebrationRequest): CelebrationState {
  // Stale deferrals must not hold cap slots against fresh ceremonies.
  const queue = pruneFresh(state.queue, request.firedAt);
  const existingIndex = queue.findIndex((queued) => queued.peerID === request.peerID);
  if (existingIndex >= 0) {
    const existing = queue[existingIndex];
    queue[existingIndex] = {
      ...existing,
      amount: existing.amount + request.amount,
      // A fresh drop refreshes the freshness anchor.
      firedAt: request.firedAt,
    };
    return { ...state, queue };
  }
  if (queue.length >= CELEBRATION_QUEUE_CAP) return { ...state, queue };
  return { ...state, queue: [...queue, request] };
}

export function celebrationReducer(
  state: CelebrationState,
  event: CelebrationEvent
): CelebrationState {
  switch (event.type) {
    case 'strike-success': {
      const request: CelebrationRequest = {
        peerID: event.peerID,
        amount: event.amount,
        unit: event.unit,
        firedAt: event.now,
        abbreviated: false,
      };

      // Same sender mid-ceremony: fold into the displayed amount.
      if (
        state.current &&
        state.current.peerID === event.peerID &&
        (state.phase === 'centering' || state.phase === 'held')
      ) {
        return {
          ...state,
          current: { ...state.current, amount: state.current.amount + event.amount },
        };
      }

      if (state.phase !== 'idle' || state.gated) {
        return enqueue(state, request);
      }

      const withinCooldown =
        state.lastStartedAt !== null && event.now - state.lastStartedAt < CELEBRATION_COOLDOWN_MS;
      return {
        ...state,
        phase: 'centering',
        current: { ...request, abbreviated: withinCooldown },
        lastStartedAt: event.now,
        ceremonyId: state.ceremonyId + 1,
      };
    }

    case 'gate-changed': {
      // Bail on no-ops (mount sync, repeated flips) — useReducer skips the
      // re-render entirely when the same reference comes back.
      if (event.gated === state.gated) return state;
      if (event.gated) {
        // A send flow took the stage: fast-forward any playing ceremony to
        // its return flight. The haptic/toast already happened — only the
        // decorative tier yields.
        const interrupted = state.phase === 'centering' || state.phase === 'held';
        return { ...state, gated: true, phase: interrupted ? 'returning' : state.phase };
      }
      const ungated = { ...state, gated: false };
      return ungated.phase === 'idle' ? startNext(ungated, event.now) : ungated;
    }

    case 'phase-complete': {
      // A timer scheduled for an earlier phase lost a race (skip, gate
      // interrupt) — ignore it rather than cutting the new phase short.
      if (event.phase !== state.phase) return state;
      switch (state.phase) {
        case 'centering':
          return { ...state, phase: 'held' };
        case 'held':
          return { ...state, phase: 'returning' };
        case 'returning':
          return startNext({ ...state, current: null }, event.now);
        case 'idle':
          return state;
      }
      return state;
    }

    case 'skip': {
      if (state.phase === 'centering' || state.phase === 'held') {
        return { ...state, phase: 'returning' };
      }
      return state;
    }

    case 'reset':
      return INITIAL_CELEBRATION_STATE;
  }
}
