/**
 * Pins the NIP-46 rate limiter: per-app and global sliding-window ceilings,
 * exact window slide, trip escalation (3 breach episodes in 10 min → 5-min
 * cooldown), cooldown expiry with a cleared trip history, and per-pubkey
 * independence. Global-ceiling denials must never trip an innocent app.
 */

import { RATE_GLOBAL_PER_MIN, RATE_PER_APP_PER_MIN } from '@/features/nostrSigner/lib/nip46Types';
import {
  createRateLimiter,
  RATE_COOLDOWN_MS,
  RATE_TRIP_LIMIT,
  RATE_TRIP_WINDOW_MS,
  RATE_WINDOW_MS,
  type Nip46RateLimiter,
} from '@/features/nostrSigner/lib/rateLimiter';

const APP_A = 'a'.repeat(64);
const APP_B = 'b'.repeat(64);

function makeClock(start = 0) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    set: (ms: number) => {
      now = ms;
    },
  };
}

function setup(start = 0) {
  const clock = makeClock(start);
  return { clock, limiter: createRateLimiter(clock.now) };
}

/** Consume the full per-app budget at the current instant. */
function fill(limiter: Nip46RateLimiter, pubkey: string) {
  for (let i = 0; i < RATE_PER_APP_PER_MIN; i++) {
    expect(limiter.take(pubkey)).toEqual({ allowed: true, throttled: false });
  }
}

/** One breach episode: fill the window, then one denied request records the trip. */
function trip(limiter: Nip46RateLimiter, pubkey: string) {
  fill(limiter, pubkey);
  return limiter.take(pubkey);
}

describe('per-app ceiling', () => {
  it('allows exactly RATE_PER_APP_PER_MIN per window, then denies without cooldown', () => {
    const { limiter } = setup();
    fill(limiter, APP_A);
    const denied = limiter.take(APP_A);
    expect(denied).toEqual({ allowed: false, throttled: false });
    expect(denied.cooldownUntil).toBeUndefined();
    expect(limiter.isThrottled(APP_A)).toBe(false);
  });

  it('slides: requests expire exactly RATE_WINDOW_MS after they were taken', () => {
    const { clock, limiter } = setup();
    fill(limiter, APP_A);

    clock.set(RATE_WINDOW_MS - 1);
    expect(limiter.take(APP_A).allowed).toBe(false);

    clock.set(RATE_WINDOW_MS);
    expect(limiter.take(APP_A).allowed).toBe(true);
  });

  it('slides partially: only the aged-out portion of the budget frees up', () => {
    const { clock, limiter } = setup();
    for (let i = 0; i < 10; i++) expect(limiter.take(APP_A).allowed).toBe(true);
    clock.set(30_000);
    for (let i = 0; i < 20; i++) expect(limiter.take(APP_A).allowed).toBe(true);
    expect(limiter.take(APP_A).allowed).toBe(false);

    // The 10 from t=0 expire; the 20 from t=30s still occupy the window.
    clock.set(RATE_WINDOW_MS);
    for (let i = 0; i < 10; i++) expect(limiter.take(APP_A).allowed).toBe(true);
    expect(limiter.take(APP_A).allowed).toBe(false);
  });
});

describe('global ceiling', () => {
  const APPS = [APP_A, APP_B, 'c'.repeat(64), 'd'.repeat(64)];

  function fillGlobal(limiter: Nip46RateLimiter) {
    expect(APPS.length * RATE_PER_APP_PER_MIN).toBe(RATE_GLOBAL_PER_MIN);
    for (const app of APPS) fill(limiter, app);
  }

  it('denies a fresh pubkey once the global window is full', () => {
    const { limiter } = setup();
    fillGlobal(limiter);
    expect(limiter.take('e'.repeat(64))).toEqual({ allowed: false, throttled: false });
  });

  it('never trips a pubkey on global-ceiling denials', () => {
    const { limiter } = setup();
    fillGlobal(limiter);
    const victim = 'e'.repeat(64);
    for (let i = 0; i < RATE_TRIP_LIMIT * 2; i++) {
      expect(limiter.take(victim)).toEqual({ allowed: false, throttled: false });
    }
    expect(limiter.isThrottled(victim)).toBe(false);
  });

  it('frees global budget as the window slides', () => {
    const { clock, limiter } = setup();
    fillGlobal(limiter);
    clock.set(RATE_WINDOW_MS);
    expect(limiter.take('e'.repeat(64)).allowed).toBe(true);
  });
});

describe('trip escalation', () => {
  it('one breach episode is one trip — repeated denials do not stack', () => {
    const { limiter } = setup();
    fill(limiter, APP_A);
    for (let i = 0; i < RATE_TRIP_LIMIT + 2; i++) {
      expect(limiter.take(APP_A)).toEqual({ allowed: false, throttled: false });
    }
    expect(limiter.isThrottled(APP_A)).toBe(false);
  });

  it('enters cooldown on the third episode within the trip window', () => {
    const { clock, limiter } = setup();
    expect(trip(limiter, APP_A).throttled).toBe(false); // trip 1 @ 0
    clock.set(61_000);
    expect(trip(limiter, APP_A).throttled).toBe(false); // trip 2 @ 61s
    clock.set(122_000);
    const result = trip(limiter, APP_A); // trip 3 @ 122s
    expect(result).toEqual({
      allowed: false,
      throttled: true,
      cooldownUntil: 122_000 + RATE_COOLDOWN_MS,
    });
    expect(limiter.isThrottled(APP_A)).toBe(true);
    expect(limiter.cooldownUntil(APP_A)).toBe(122_000 + RATE_COOLDOWN_MS);
  });

  it('silently denies everything during the cooldown, even with a drained window', () => {
    const { clock, limiter } = setup();
    trip(limiter, APP_A);
    clock.set(61_000);
    trip(limiter, APP_A);
    clock.set(122_000);
    trip(limiter, APP_A);

    // Window has long drained, but the cooldown holds.
    clock.set(122_000 + RATE_COOLDOWN_MS - 1);
    expect(limiter.take(APP_A)).toEqual({
      allowed: false,
      throttled: true,
      cooldownUntil: 122_000 + RATE_COOLDOWN_MS,
    });
  });

  it('lets old trips age out of the trip window', () => {
    const { clock, limiter } = setup();
    trip(limiter, APP_A); // trip 1 @ 0
    clock.set(100_000);
    trip(limiter, APP_A); // trip 2 @ 100s
    clock.set(RATE_TRIP_WINDOW_MS + 1_000);
    // Trip 1 aged out — this is the second trip in the window, not the third.
    expect(trip(limiter, APP_A).throttled).toBe(false); // trip 3 @ 601s
    expect(limiter.isThrottled(APP_A)).toBe(false);

    clock.set(680_000);
    // Trips @ 100s, 601s, 680s are all inside the window → cooldown.
    expect(trip(limiter, APP_A).throttled).toBe(true);
  });
});

describe('cooldown expiry', () => {
  function escalate(limiter: Nip46RateLimiter, clock: ReturnType<typeof makeClock>) {
    trip(limiter, APP_A);
    clock.set(61_000);
    trip(limiter, APP_A);
    clock.set(122_000);
    return trip(limiter, APP_A);
  }

  it('clears at exactly cooldownUntil and allows requests again', () => {
    const { clock, limiter } = setup();
    const { cooldownUntil } = escalate(limiter, clock);
    expect(cooldownUntil).toBe(122_000 + RATE_COOLDOWN_MS);

    clock.set(cooldownUntil! - 1);
    expect(limiter.isThrottled(APP_A)).toBe(true);

    clock.set(cooldownUntil!);
    expect(limiter.isThrottled(APP_A)).toBe(false);
    expect(limiter.cooldownUntil(APP_A)).toBeNull();
    expect(limiter.take(APP_A)).toEqual({ allowed: true, throttled: false });
  });

  it('clears the trip history when the cooldown starts — no instant re-trip', () => {
    const { clock, limiter } = setup();
    const { cooldownUntil } = escalate(limiter, clock);

    // Still inside the 10-min trip window of the original trips; had the
    // history survived, one new episode would re-enter cooldown immediately.
    clock.set(cooldownUntil!);
    expect(cooldownUntil! < RATE_TRIP_WINDOW_MS).toBe(true);
    expect(trip(limiter, APP_A).throttled).toBe(false);
    expect(limiter.isThrottled(APP_A)).toBe(false);
  });
});

describe('pubkey independence', () => {
  it('keeps windows separate — one app at its ceiling does not deny another', () => {
    const { limiter } = setup();
    fill(limiter, APP_A);
    expect(limiter.take(APP_A).allowed).toBe(false);
    expect(limiter.take(APP_B).allowed).toBe(true);
  });

  it('keeps cooldowns separate — a throttled app does not flag others', () => {
    const { clock, limiter } = setup();
    trip(limiter, APP_A);
    clock.set(61_000);
    trip(limiter, APP_A);
    clock.set(122_000);
    trip(limiter, APP_A);

    expect(limiter.isThrottled(APP_A)).toBe(true);
    expect(limiter.isThrottled(APP_B)).toBe(false);
    expect(limiter.take(APP_B)).toEqual({ allowed: true, throttled: false });
  });
});

describe('inspection helpers', () => {
  it('reports unknown pubkeys as not throttled', () => {
    const { limiter } = setup();
    expect(limiter.isThrottled(APP_A)).toBe(false);
    expect(limiter.cooldownUntil(APP_A)).toBeNull();
  });

  it('does not create tracking state for inspected pubkeys', () => {
    const { limiter } = setup();
    // Polling the UI flag repeatedly must not affect rate accounting.
    for (let i = 0; i < 100; i++) limiter.isThrottled(APP_A);
    fill(limiter, APP_A);
    expect(limiter.take(APP_A).allowed).toBe(false);
  });
});
