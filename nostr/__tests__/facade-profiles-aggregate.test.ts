import { describe, test, expect, vi, afterEach } from 'vitest';
import { ok, type Result } from 'neverthrow';
import { createNostrDataLayer } from '../src/facade';
import { createRelayTier, type RelayConnection, type RawRelayEvent } from '../src/facade/relay';
import { createPrimalTier, type PrimalConnection, type RawPrimalEvent } from '../src/facade/primal';
import type { NaggError } from '../src/errors';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const D = 'd'.repeat(64);
const E = 'e'.repeat(64);

function kind0(pubkey: string, name: string, idChar: string): RawRelayEvent {
  return { id: idChar.repeat(64), pubkey, kind: 0, content: JSON.stringify({ name }), created_at: 100 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe('getProfiles fans out and gap-fills across tiers', () => {
  test('paints Primal partial at the cap, relay fills the rest, pending ends only at complete', async () => {
    vi.useFakeTimers();
    const relayAnswer = deferred<Result<RawRelayEvent[], NaggError>>();
    const primal: PrimalConnection = {
      request: (): Promise<Result<RawPrimalEvent[], NaggError>> =>
        Promise.resolve(ok([kind0(A, 'alice', '1'), kind0(B, 'bob', '2'), kind0(C, 'cara', '3')])),
    };
    const relayRequests: unknown[] = [];
    const relay: RelayConnection = {
      request: (filters) => {
        relayRequests.push(filters);
        return relayAnswer.promise;
      },
    };
    const layer = createNostrDataLayer({
      tiers: [createPrimalTier({ connection: primal }), createRelayTier({ connection: relay })],
    });

    const pending = layer.getProfiles({ pubkeys: [A, B, C, D, E] });
    // Both tiers were opened at once (no waterfall).
    await vi.advanceTimersByTimeAsync(0);
    expect(relayRequests).toHaveLength(1);
    // Primal answered 3 of 5: not enough for minItems, so the cap releases the paint.
    await vi.advanceTimersByTimeAsync(800);
    const first = (await pending)._unsafeUnwrap();
    expect(first.tier).toBe('primal');
    expect(Object.keys(first.profiles).sort()).toEqual([A, B, C].sort());
    expect(first.provenance).toMatchObject({ sources: ['primal'], complete: false, degraded: false });
    // The unfilled pubkeys stay pending (skeleton, not fallback) while relay is still in flight.
    expect(layer.cache.pendingProfiles.has(D)).toBe(true);
    expect(layer.cache.pendingProfiles.has(A)).toBe(true);

    relayAnswer.resolve(ok([kind0(D, 'dan', '4'), kind0(E, 'eve', '5')]));
    await vi.advanceTimersByTimeAsync(0);
    // Late answers land in the shared entity cache and release the pending marks.
    expect(layer.cache.getProfile(D)?.name).toBe('dan');
    expect(layer.cache.getProfile(E)?.name).toBe('eve');
    expect(layer.cache.pendingProfiles.has(D)).toBe(false);
    expect(layer.cache.pendingProfiles.has(A)).toBe(false);
  });

  test('a better-ranked later answer wins the cached fields; a worse-ranked one cannot erase them', async () => {
    const primalAnswer = deferred<Result<RawPrimalEvent[], NaggError>>();
    const primal: PrimalConnection = { request: () => primalAnswer.promise };
    const relay: RelayConnection = {
      request: () => Promise.resolve(ok([kind0(A, 'relay-alice', '1')])),
    };
    const layer = createNostrDataLayer({
      tiers: [createPrimalTier({ connection: primal }), createRelayTier({ connection: relay })],
    });
    const first = (await layer.getProfiles({ pubkeys: [A] }))._unsafeUnwrap();
    expect(first.tier).toBe('relay');
    expect(first.profiles[A]?.name).toBe('relay-alice');

    primalAnswer.resolve(ok([kind0(A, 'primal-alice', '2')]));
    await flush();
    expect(layer.cache.getProfile(A)?.name).toBe('primal-alice');
  });

  test('all tiers failing still yields one all_tiers_exhausted error and clears pending', async () => {
    const boom = (): Promise<Result<never[], NaggError>> =>
      Promise.resolve({ isOk: () => false, isErr: () => true } as never);
    const relay: RelayConnection = { request: () => Promise.reject(new Error('offline')) };
    const layer = createNostrDataLayer({ tiers: [createRelayTier({ connection: relay })] });
    void boom;
    const result = await layer.getProfiles({ pubkeys: [A] });
    expect(result.isErr()).toBe(true);
    expect(layer.cache.pendingProfiles.has(A)).toBe(false);
  });
});
