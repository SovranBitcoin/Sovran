/**
 * @jest-environment node
 *
 * Regression: navigating to a profile flashed placeholder → clay fallback →
 * real image. `isLoading` (missing and resolving) is false for the whole
 * revalidation of a feed-seeded name-only record (stale, not missing), so
 * surfaces briefly rendered the generative fallback that the in-flight fetch
 * was about to replace. `isResolving` must cover the first render, the frame
 * the request waits for its batch, and the fetch itself.
 *
 * The hook keeps no fetch state: the real data layer and entity cache run
 * here, over a relay connection the test answers by hand.
 */

import { act, renderHook } from '@testing-library/react-native';
import { ok } from 'neverthrow';
import { facade } from 'nostr';

import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';

let mockLayer: facade.NostrDataLayer | null;
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => mockLayer,
}));

const PUBKEY = 'a'.repeat(64);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function layerAnswering() {
  const answer = deferred<facade.relay.RawRelayEvent[]>();
  const request = jest.fn(async () => ok(await answer.promise));
  mockLayer = facade.createNostrDataLayer({
    tiers: [facade.relay.createRelayTier({ connection: { request } })],
  });
  return { answer, request, layer: mockLayer };
}

const kind0 = (content: Record<string, string>, createdAt = 1_700_000_000) => ({
  id: 'e'.repeat(64),
  pubkey: PUBKEY,
  kind: 0,
  created_at: createdAt,
  content: JSON.stringify(content),
});

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('useNostrProfileMetadata isResolving', () => {
  it('is true on every render from the first, for a cache-missing pubkey, until the fetch settles', async () => {
    const { answer } = layerAnswering();
    // Record every render's value: the first frame is the one that used to
    // flash the clay fallback.
    const frames: { isLoading: boolean; isResolving: boolean }[] = [];
    const { result } = renderHook(() => {
      const value = useNostrProfileMetadata(PUBKEY);
      frames.push({ isLoading: value.isLoading, isResolving: value.isResolving });
      return value;
    });
    expect(frames[0]).toEqual({ isLoading: true, isResolving: true });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(16);
    });
    expect(frames.every((frame) => frame.isResolving)).toBe(true);

    await act(async () => {
      answer.resolve([kind0({ picture: 'https://img' })]);
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.isResolving).toBe(false);
    expect(result.current.metadata?.picture).toBe('https://img');
  });

  it('stays true while a seeded name-only record revalidates (stale, not missing)', async () => {
    const { layer } = layerAnswering();
    layer.cache.ingestProfileInfos({ [PUBKEY]: { name: 'seeded-name' } }, 'cache');
    const { result } = renderHook(() => useNostrProfileMetadata(PUBKEY));
    // The seeded hint is served (name available for first paint)…
    expect(result.current.metadata).toMatchObject({ name: 'seeded-name', fetchedAt: 0 });
    expect(result.current.isLoading).toBe(false);
    // …but the avatar-deciding fetch is still owed, then in flight.
    expect(result.current.isResolving).toBe(true);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(16);
    });
    expect(result.current.isResolving).toBe(true);
  });

  it('settles false once every source has answered without the profile, and does not ask again', async () => {
    const { answer, request } = layerAnswering();
    const { result, rerender, unmount } = renderHook(() => useNostrProfileMetadata(PUBKEY));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(16);
      answer.resolve([]);
      await jest.advanceTimersByTimeAsync(0);
    });
    // Nothing found: the fallback may now show.
    expect(result.current.isResolving).toBe(false);
    expect(result.current.isLoading).toBe(false);
    // Re-rendering and remounting inside the miss window ask nobody.
    rerender({});
    unmount();
    renderHook(() => useNostrProfileMetadata(PUBKEY));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('asks again on the next mount after the miss has expired', async () => {
    const { answer, request } = layerAnswering();
    const first = renderHook(() => useNostrProfileMetadata(PUBKEY));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(16);
      answer.resolve([]);
      await jest.advanceTimersByTimeAsync(0);
    });
    first.unmount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(61_000);
    });
    renderHook(() => useNostrProfileMetadata(PUBKEY));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(16);
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('is not resolving, and holds no placeholder, when every tier is switched off', () => {
    mockLayer = null;
    const { result } = renderHook(() => useNostrProfileMetadata(PUBKEY));
    expect(result.current).toMatchObject({ metadata: undefined, isLoading: false, isResolving: false });
  });

  it('does not refetch a profile fetched inside the staleness window', async () => {
    const { layer, request } = layerAnswering();
    layer.cache.ingestProfileMetadata({ [PUBKEY]: { name: 'fresh' } }, 1, 'relay', {
      createdAt: { [PUBKEY]: 1_700_000_000 },
    });
    const { result } = renderHook(() => useNostrProfileMetadata(PUBKEY));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_000);
    });
    expect(result.current.isResolving).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
});
