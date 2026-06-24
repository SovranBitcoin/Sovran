/**
 * Pure state machine for the Nut Drop receive celebration — the full-screen
 * gold takeover on the radar. No timers, no store access: the hook observes
 * strike-map transitions, dispatches events with explicit `now` stamps, and
 * schedules `phase-complete` for the choreography beats.
 *
 * The ceremony starts when a locked drop ARRIVES (fresh strike turns
 * active): the sender's avatar flies to center stage and crackles gold
 * while the redeem runs ('awaiting'). The impact (sky bolts + haptic +
 * amount reveal) fires on CONFIRMED success. A retry-waiting receive gets the
 * full lightning beat without an amount reveal. A failed or stuck redeem exits
 * with a quiet return flight.
 *
 * Restraint rules live here (unit-tested), not in the animation code:
 * - one ceremony at a time; same-sender redemptions fold into the displayed
 *   amount; other senders queue (cap 2 — overflow drops silently, the
 *   payment toast already carried the money truth);
 * - repeats inside the cooldown and anything played from the queue use the
 *   abbreviated hold (repeat-exposure fatigue);
 * - while gated (send flow active) requests defer, and only requests still
 *   inside the freshness window play once the gate lifts;
 * - `skip` (tap-anywhere, or a send starting) jumps straight to the return
 *   flight — the celebration never blocks an interaction.
 */

export type CelebrationPhase = 'idle' | 'centering' | 'awaiting' | 'held' | 'returning';

export interface CelebrationRequest {
  peerID: string;
  /** Confirmed redeemed amount — null until the strike reports success. */
  amount: number | null;
  unit: string;
  /** True when the token was accepted locally and will retry when online. */
  waiting: boolean;
  /** When the request was last refreshed (UNIX ms) — freshness anchor. */
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
  /** A fresh locked drop started redeeming — begin the takeover. */
  | { type: 'strike-active'; peerID: string; unit: string; now: number }
  /** The redeem confirmed; `amount` is the per-cycle delta. */
  | { type: 'strike-success'; peerID: string; amount: number; unit: string; now: number }
  /** The redeem was accepted locally and is waiting for network/mint recovery. */
  | { type: 'strike-waiting'; peerID: string; now: number }
  /** The redeem failed or went backoff-stuck — exit without an impact. */
  | { type: 'strike-failed'; peerID: string; now: number }
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

const ACTIVE_PHASES: readonly CelebrationPhase[] = ['centering', 'awaiting', 'held'];

function isPlaying(state: CelebrationState): boolean {
  return ACTIVE_PHASES.includes(state.phase);
}

function pruneFresh(queue: readonly CelebrationRequest[], now: number): CelebrationRequest[] {
  return queue.filter((request) => now - request.firedAt <= CELEBRATION_FRESHNESS_MS);
}

function startCeremony(
  state: CelebrationState,
  request: CelebrationRequest,
  now: number,
  forceAbbreviated: boolean
): CelebrationState {
  const withinCooldown =
    state.lastStartedAt !== null && now - state.lastStartedAt < CELEBRATION_COOLDOWN_MS;
  return {
    ...state,
    phase: 'centering',
    current: { ...request, abbreviated: forceAbbreviated || withinCooldown },
    lastStartedAt: now,
    ceremonyId: state.ceremonyId + 1,
  };
}

/** Pop the next fresh queued request into a playing ceremony, if allowed. */
function startNext(state: CelebrationState, now: number): CelebrationState {
  const fresh = pruneFresh(state.queue, now);
  if (state.gated || fresh.length === 0) {
    return { ...state, phase: 'idle', current: null, queue: fresh };
  }
  const [next, ...rest] = fresh;
  // Anything that had to wait plays the abbreviated hold.
  return startCeremony({ ...state, queue: rest }, next, now, true);
}

function enqueue(state: CelebrationState, request: CelebrationRequest): CelebrationState {
  // Stale deferrals must not hold cap slots against fresh ceremonies.
  const queue = pruneFresh(state.queue, request.firedAt);
  const existingIndex = queue.findIndex((queued) => queued.peerID === request.peerID);
  if (existingIndex >= 0) {
    const existing = queue[existingIndex];
    queue[existingIndex] = {
      ...existing,
      amount: request.amount === null ? existing.amount : (existing.amount ?? 0) + request.amount,
      waiting: existing.waiting || request.waiting,
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
    case 'strike-active': {
      // Already celebrating this sender — the success event will fold in.
      if (state.current?.peerID === event.peerID && isPlaying(state)) return state;
      const request: CelebrationRequest = {
        peerID: event.peerID,
        amount: null,
        unit: event.unit,
        waiting: false,
        firedAt: event.now,
        abbreviated: false,
      };
      if (state.phase !== 'idle' || state.gated) return enqueue(state, request);
      return startCeremony(state, request, event.now, false);
    }

    case 'strike-success': {
      // Same sender mid-ceremony: confirm/extend the displayed amount. From
      // 'awaiting' the impact fires immediately; from 'centering' it fires
      // on arrival (the beat clock sees the amount and goes to 'held').
      if (state.current?.peerID === event.peerID) {
        if (state.phase === 'centering' || state.phase === 'awaiting' || state.phase === 'held') {
          return {
            ...state,
            phase: state.phase === 'awaiting' ? 'held' : state.phase,
            current: {
              ...state.current,
              waiting: false,
              amount: (state.current.amount ?? 0) + event.amount,
              unit: event.unit,
            },
          };
        }
        // 'returning' — this redeem already had its ceremony interrupted or
        // is a fresh drop landing late; queue a fresh (abbreviated) one.
      }

      const request: CelebrationRequest = {
        peerID: event.peerID,
        amount: event.amount,
        unit: event.unit,
        waiting: false,
        firedAt: event.now,
        abbreviated: false,
      };
      if (state.phase !== 'idle' || state.gated) return enqueue(state, request);
      // Success with no prior staging (ambient entries, races): play the
      // whole ceremony with the amount known — impact on arrival.
      return startCeremony(state, request, event.now, false);
    }

    case 'strike-waiting': {
      if (state.current?.peerID === event.peerID) {
        if (state.phase === 'centering' || state.phase === 'awaiting' || state.phase === 'held') {
          return {
            ...state,
            phase: state.phase === 'awaiting' ? 'held' : state.phase,
            current: { ...state.current, waiting: true },
          };
        }
      }

      const request: CelebrationRequest = {
        peerID: event.peerID,
        amount: null,
        unit: 'sat',
        waiting: true,
        firedAt: event.now,
        abbreviated: false,
      };
      if (state.phase !== 'idle' || state.gated) return enqueue(state, request);
      return startCeremony(state, request, event.now, false);
    }

    case 'strike-failed': {
      // Quiet exit: no impact, no amount — the toast carries the error.
      const queue = state.queue.filter((queued) => queued.peerID !== event.peerID);
      const queueChanged = queue.length !== state.queue.length;
      if (
        state.current?.peerID === event.peerID &&
        (state.phase === 'centering' || state.phase === 'awaiting')
      ) {
        return { ...state, queue, phase: 'returning' };
      }
      return queueChanged ? { ...state, queue } : state;
    }

    case 'gate-changed': {
      // Bail on no-ops (mount sync, repeated flips) — useReducer skips the
      // re-render entirely when the same reference comes back.
      if (event.gated === state.gated) return state;
      if (event.gated) {
        // A send flow took the stage: fast-forward any playing ceremony to
        // its return flight. Only the decorative tier yields.
        return { ...state, gated: true, phase: isPlaying(state) ? 'returning' : state.phase };
      }
      const ungated = { ...state, gated: false };
      return ungated.phase === 'idle' ? startNext(ungated, event.now) : ungated;
    }

    case 'phase-complete': {
      // A timer scheduled for an earlier phase lost a race (skip, gate
      // interrupt, success-driven 'awaiting' → 'held') — ignore it rather
      // than cutting the new phase short.
      if (event.phase !== state.phase) return state;
      switch (state.phase) {
        case 'centering':
          // Arrival: impact if the redeem already confirmed, otherwise park
          // at center and crackle until it does.
          return {
            ...state,
            phase:
              state.current !== null && (state.current.amount !== null || state.current.waiting)
                ? 'held'
                : 'awaiting',
          };
        case 'awaiting':
          // Safety timeout — the strike layer normally reports failure
          // first (its own max-active cap), but never hold center forever.
          return { ...state, phase: 'returning' };
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
      if (isPlaying(state)) return { ...state, phase: 'returning' };
      return state;
    }

    case 'reset':
      return INITIAL_CELEBRATION_STATE;
  }
}
