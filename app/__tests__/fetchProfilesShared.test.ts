/** @jest-environment node */
import { facade } from 'nostr';
import { act, renderHook } from '@testing-library/react-native';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { ok } from 'neverthrow';
import { fetchProfilesViaFacade } from '@/shared/lib/nostr/fetchProfiles';

let mockLayer: facade.NostrDataLayer;
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => mockLayer,
}));
const alice = 'a'.repeat(64);
const bob = 'b'.repeat(64);
const carol = 'c'.repeat(64);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it('shares overlapping Home and row enrichment while fetching only new keys', async () => {
  const answer = deferred<facade.relay.RawRelayEvent[]>();
  const request = jest.fn(async (filters: Parameters<facade.relay.RelayConnection['request']>[0]) =>
    ok(
      (await answer.promise).filter((event) =>
        filters.some((filter) => filter.authors?.includes(event.pubkey ?? ''))
      )
    )
  );
  mockLayer = facade.createNostrDataLayer({
    tiers: [facade.relay.createRelayTier({ connection: { request } })],
  });
  const home = fetchProfilesViaFacade([alice, bob], { refresh: true });
  const row = fetchProfilesViaFacade([bob, carol], { refresh: true });
  answer.resolve(
    [alice, bob, carol].map((pubkey) => ({
      id: pubkey,
      pubkey,
      kind: 0,
      created_at: 1,
      content: JSON.stringify({ name: pubkey[0] }),
    }))
  );
  expect(await home).toMatchObject({ [alice]: { name: 'a' }, [bob]: { name: 'b' } });
  expect(await row).toEqual({
    [bob]: expect.objectContaining({ name: 'b' }),
    [carol]: expect.objectContaining({ name: 'c' }),
  });
  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenNthCalledWith(2, [{ kinds: [0], authors: [carol] }], expect.anything());
});

it('releases a completed miss so a later lookup can retry', async () => {
  const request = jest.fn(async () => ok([]));
  mockLayer = facade.createNostrDataLayer({
    tiers: [facade.relay.createRelayTier({ connection: { request } })],
  });
  expect(await fetchProfilesViaFacade([alice], { refresh: true })).toEqual({});
  expect(await fetchProfilesViaFacade([alice], { refresh: true })).toEqual({});
  expect(request).toHaveBeenCalledTimes(2);
});

it('does not join another account or a caller-owned cancellation signal', async () => {
  const answer = deferred<facade.relay.RawRelayEvent[]>();
  const request = jest.fn(async () => ok(await answer.promise));
  const createLayer = () =>
    facade.createNostrDataLayer({
      tiers: [facade.relay.createRelayTier({ connection: { request } })],
    });
  mockLayer = createLayer();
  const first = fetchProfilesViaFacade([alice], { refresh: true });
  const controller = new AbortController();
  const cancellable = fetchProfilesViaFacade([alice], { refresh: true, signal: controller.signal });
  mockLayer = createLayer();
  const switched = fetchProfilesViaFacade([alice], { refresh: true });
  answer.resolve([
    { id: alice, pubkey: alice, kind: 0, created_at: 1, content: '{"name":"Alice"}' },
  ]);
  for (const result of await Promise.all([first, cancellable, switched])) {
    expect(result[alice]?.name).toBe('Alice');
  }
  expect(request).toHaveBeenCalledTimes(3);
  expect(request).toHaveBeenNthCalledWith(
    2,
    [{ kinds: [0], authors: [alice] }],
    expect.objectContaining({ signal: controller.signal })
  );
});

it('shares late gap filling after the first aggregate answer has returned', async () => {
  jest.useFakeTimers();
  try {
    const slow = deferred<facade.relay.RawRelayEvent[]>();
    const relay = jest.fn(async () => ok(await slow.promise));
    mockLayer = facade.createNostrDataLayer({
      tiers: [
        facade.primal.createPrimalTier({
          connection: {
            request: async () =>
              ok([
                { id: alice, pubkey: alice, kind: 0, created_at: 1, content: '{"name":"Alice"}' },
              ]),
          },
        }),
        facade.relay.createRelayTier({ connection: { request: relay } }),
      ],
    });
    const first = fetchProfilesViaFacade([alice, bob], { refresh: true });
    await jest.advanceTimersByTimeAsync(800);
    expect(mockLayer.cache.getProfile(alice)?.name).toBe('Alice');
    const joined = fetchProfilesViaFacade([bob], { refresh: true });
    expect(relay).toHaveBeenCalledTimes(1);
    slow.resolve([{ id: bob, pubkey: bob, kind: 0, created_at: 1, content: '{"name":"Bob"}' }]);
    await jest.advanceTimersByTimeAsync(0);
    expect((await first)[bob]?.name).toBe('Bob');
    expect((await joined)[bob]?.name).toBe('Bob');
    expect(mockLayer.cache.getProfile(bob)?.name).toBe('Bob');
    expect((await fetchProfilesViaFacade([bob]))[bob]?.name).toBe('Bob');
    expect(relay).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

it('keeps a mounted row eligible to retry after shared slow sources miss', async () => {
  jest.useFakeTimers();
  try {
    const relay = jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 9500));
      return ok([]);
    });
    mockLayer = facade.createNostrDataLayer({
      tiers: [
        facade.primal.createPrimalTier({
          connection: {
            request: async () =>
              ok([
                { id: alice, pubkey: alice, kind: 0, created_at: 1, content: '{"name":"Alice"}' },
              ]),
          },
        }),
        facade.relay.createRelayTier({ connection: { request: relay } }),
      ],
    });
    const home = fetchProfilesViaFacade([alice, bob], { refresh: true });
    const row = renderHook(() => useNostrProfileMetadata(bob));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(8800);
    });
    expect(row.result.current.isResolving).toBe(true);
    expect(relay).toHaveBeenCalledTimes(1);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(700);
    });
    await home;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(4000);
    });
    expect(relay).toHaveBeenCalledTimes(2);
    row.unmount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(9500);
    });
  } finally {
    jest.useRealTimers();
  }
});

it('retains seeded display data without treating a failed refresh as resolution', async () => {
  mockLayer = facade.createNostrDataLayer({ tiers: [] });
  mockLayer.cache.ingestProfileMetadata({ [alice]: { name: 'Seeded Alice' } }, 0, 'relay');
  expect(await fetchProfilesViaFacade([alice], { refresh: true })).toEqual({});
  expect(mockLayer.cache.getProfile(alice)?.name).toBe('Seeded Alice');
});
