/**
 * @fileoverview NIP-46 request rate limiter
 *
 * Pure in-memory sliding windows — no IO, no react, no persistence (state
 * resets with the process, matching the runtime-only queue design). The
 * engine calls take() once per inbound request, after sender lookup and
 * before decrypt, so population is bounded by connected apps (≤64) plus
 * pending pairings. The clock is injected so tests control time.
 */

import { RATE_GLOBAL_PER_MIN, RATE_PER_APP_PER_MIN } from '@/features/nostrSigner/lib/nip46Types';

export const RATE_WINDOW_MS = 60_000;

// Trip escalation: 3 ceiling breaches within 10 min → 5-min silent-deny cooldown.
export const RATE_TRIP_LIMIT = 3;
export const RATE_TRIP_WINDOW_MS = 600_000;
export const RATE_COOLDOWN_MS = 300_000;

interface RateLimitResult {
  /** Process this request. False → engine silently denies with "rate limited". */
  allowed: boolean;
  /** Pubkey is inside a trip-escalation cooldown — surface the UI flag. */
  throttled: boolean;
  /** Epoch ms; present iff throttled. */
  cooldownUntil?: number;
}

export interface Nip46RateLimiter {
  take(pubkey: string): RateLimitResult;
  /** UI flag: "This app is sending unusual amounts of requests." */
  isThrottled(pubkey: string): boolean;
  cooldownUntil(pubkey: string): number | null;
}

interface AppState {
  /** Epoch-ms timestamps of allowed requests inside the sliding window. */
  window: number[];
  /** Epoch-ms timestamps of ceiling-breach episodes (not of each denied request). */
  trips: number[];
  /**
   * True from a per-app ceiling breach until the next allowed request. A
   * sustained flood is one episode = one trip; escalation needs three
   * distinct episodes, not three denied packets.
   */
  inBreach: boolean;
  cooldownUntil: number | null;
}

function prune(timestamps: number[], cutoff: number): number[] {
  // Appended in clock order; drop everything at or before the cutoff.
  let start = 0;
  while (start < timestamps.length && timestamps[start] <= cutoff) start++;
  return start === 0 ? timestamps : timestamps.slice(start);
}

export function createRateLimiter(clock: () => number = Date.now): Nip46RateLimiter {
  const apps = new Map<string, AppState>();
  let globalWindow: number[] = [];

  function getApp(pubkey: string): AppState {
    let app = apps.get(pubkey);
    if (!app) {
      app = { window: [], trips: [], inBreach: false, cooldownUntil: null };
      apps.set(pubkey, app);
    }
    return app;
  }

  function activeCooldown(app: AppState, now: number): number | null {
    if (app.cooldownUntil !== null && app.cooldownUntil <= now) app.cooldownUntil = null;
    return app.cooldownUntil;
  }

  function take(pubkey: string): RateLimitResult {
    const now = clock();
    const app = getApp(pubkey);
    app.window = prune(app.window, now - RATE_WINDOW_MS);
    app.trips = prune(app.trips, now - RATE_TRIP_WINDOW_MS);
    globalWindow = prune(globalWindow, now - RATE_WINDOW_MS);

    const cooldownUntil = activeCooldown(app, now);
    if (cooldownUntil !== null) {
      return { allowed: false, throttled: true, cooldownUntil };
    }

    if (app.window.length >= RATE_PER_APP_PER_MIN) {
      if (!app.inBreach) {
        app.inBreach = true;
        app.trips.push(now);
        if (app.trips.length >= RATE_TRIP_LIMIT) {
          app.cooldownUntil = now + RATE_COOLDOWN_MS;
          // Fresh slate after the cooldown — expiry must not re-trip instantly.
          app.trips = [];
          app.inBreach = false;
          return { allowed: false, throttled: true, cooldownUntil: app.cooldownUntil };
        }
      }
      return { allowed: false, throttled: false };
    }

    if (globalWindow.length >= RATE_GLOBAL_PER_MIN) {
      // Another app may have filled the global bucket — deny, but never trip
      // this pubkey (the per-app flag must not smear innocent apps).
      return { allowed: false, throttled: false };
    }

    app.inBreach = false;
    app.window.push(now);
    globalWindow.push(now);
    return { allowed: true, throttled: false };
  }

  function cooldownUntil(pubkey: string): number | null {
    const app = apps.get(pubkey);
    if (!app) return null;
    return activeCooldown(app, clock());
  }

  return {
    take,
    isThrottled: (pubkey) => cooldownUntil(pubkey) !== null,
    cooldownUntil,
  };
}
