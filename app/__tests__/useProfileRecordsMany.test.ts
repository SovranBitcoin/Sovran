import { act, renderHook } from '@testing-library/react-native';
import { facade } from 'nostr';
import { ok } from 'neverthrow';
import { DEMO_FEED, DEMO_PROFILES } from '@/shared/stores/runtime/mockPresentationData';
import { useProfile, useProfileRecordsMany } from '@/shared/lib/nostr/useEntityCache';

let mockMode = false;
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (selector: (state: { mockMode: boolean }) => unknown) => selector({ mockMode }),
}));
let mockLayer: facade.NostrDataLayer | undefined;
let mockCache: facade.NostrEntityCache;
let mockStore: facade.NormalizingStore<facade.CachedProfile>;
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => mockLayer ?? { cache: { ...mockCache, profiles: mockStore } },
}));

beforeEach(() => {
  mockMode = false;
  mockLayer = undefined;
  mockCache = facade.createNostrEntityCache();
  mockStore = facade.createNormalizingStore({ maxEntries: 1000 });
});

it('does not rerender a contact batch for unrelated feed-author writes', () => {
  mockStore.set('contact', { name: 'Known contact', seenAt: 1 });
  let renders = 0;
  const keys = ['contact'];
  const { result } = renderHook(() => {
    renders += 1;
    return useProfileRecordsMany(keys);
  });
  const initial = result.current;
  const before = renders;
  for (let index = 0; index < 20; index += 1) {
    act(() => mockStore.set(`unrelated-${index}`, { name: 'Feed author', seenAt: 1 }));
  }
  expect(renders - before).toBe(0);
  expect(result.current).toBe(initial);

  act(() => mockStore.set('contact', { name: 'Updated contact' }));
  expect(result.current.get('contact')?.name).toBe('Updated contact');
  expect(renders - before).toBe(1);
});

it('leaves LRU order alone when an unrelated profile is written', () => {
  // Capacity 3: the two observed contacts plus one slot. Re-inserting the
  // observed keys on every notification would keep them newest forever.
  mockStore = facade.createNormalizingStore({ maxEntries: 3 });
  mockStore.set('contact-a', { name: 'A', seenAt: 1 });
  mockStore.set('contact-b', { name: 'B', seenAt: 1 });
  const keys = ['contact-a', 'contact-b'];
  const { result } = renderHook(() => useProfileRecordsMany(keys));
  const touching = jest.spyOn(mockStore, 'get');

  act(() => mockStore.set('unrelated-1', { name: 'Feed author', seenAt: 1 }));
  expect(touching).not.toHaveBeenCalled();
  expect([...mockStore.values()].map((record) => record.name)).toEqual(['A', 'B', 'Feed author']);

  // The next new key evicts the oldest entry, and the consumer sees it go.
  act(() => mockStore.set('unrelated-2', { name: 'Feed author', seenAt: 1 }));
  expect(mockStore.has('contact-a')).toBe(false);
  expect([...result.current.keys()]).toEqual(['contact-b']);
});

it('marks its profiles recently used when it mounts', () => {
  mockStore = facade.createNormalizingStore({ maxEntries: 2 });
  mockStore.set('contact', { name: 'Contact', seenAt: 1 });
  mockStore.set('other', { name: 'Other', seenAt: 1 });
  const keys = ['contact'];
  renderHook(() => useProfileRecordsMany(keys));
  act(() => mockStore.set('newcomer', { name: 'Newcomer', seenAt: 1 }));
  expect(mockStore.has('contact')).toBe(true);
  expect(mockStore.has('other')).toBe(false);
});

it('reads the new profile-owned store when requested keys stay identical', () => {
  mockStore.set('contact', { name: 'Old scope', seenAt: 1 });
  const keys = ['contact'];
  const { result, rerender } = renderHook(() => useProfileRecordsMany(keys));
  mockStore = facade.createNormalizingStore({ maxEntries: 1000 });
  mockStore.set('contact', { name: 'New scope', seenAt: 1 });
  rerender(undefined);
  expect(result.current.get('contact')?.name).toBe('New scope');
});

it('updates when an observed contact is evicted by an unrelated write', () => {
  mockStore = facade.createNormalizingStore({ maxEntries: 1 });
  mockStore.set('contact', { name: 'Evicted contact', seenAt: 1 });
  const keys = ['contact'];
  const { result } = renderHook(() => useProfileRecordsMany(keys));
  act(() => mockStore.set('replacement', { name: 'Replacement', seenAt: 1 }));
  expect(result.current.size).toBe(0);
});

it('overlays demo authors without caching them and restores live names when disabled', () => {
  const pubkey = DEMO_FEED[0].pubkey;
  mockStore.set(pubkey, { name: 'Live author', seenAt: 1 });
  const { result, rerender } = renderHook(() => useProfile(pubkey));
  expect(result.current.profile?.name).toBe('Live author');
  mockMode = true;
  rerender(undefined);
  expect(result.current.profile?.name).toBe(DEMO_PROFILES.get(pubkey)?.name);
  expect(mockStore.get(pubkey)?.name).toBe('Live author');
  mockMode = false;
  rerender(undefined);
  expect(result.current.profile?.name).toBe('Live author');
});

it('keeps a name-only seed grey through pending until kind-0 arrives', () => {
  mockStore = mockCache.profiles;
  mockCache.ingestProfileInfos({ author: { name: 'Seed' } }, 'cache');
  const { result } = renderHook(() => useProfile('author'));
  expect(result.current.status).toBe('loading');
  act(() => mockCache.pendingProfiles.begin(['author']));
  expect(result.current.status).toBe('loading');
  act(() => mockCache.ingestProfileMetadata({ author: { picture: 'real.png' } }, 1, 'relay'));
  expect(result.current.status).toBe('loading');
  act(() => mockCache.pendingProfiles.end(['author']));
  expect(result.current.status).toBe('cached');
  expect(result.current.profile?.picture).toBe('real.png');
});

it('settles a missing stranger and a picture-less seed after a failed attempt', () => {
  mockStore = mockCache.profiles;
  mockCache.ingestProfileInfos({ seed: { name: 'Seed' } }, 'cache');
  const missing = renderHook(() => useProfile('stranger'));
  const seeded = renderHook(() => useProfile('seed'));
  expect(missing.result.current.status).toBe('loading');
  expect(seeded.result.current.status).toBe('loading');
  act(() => mockCache.pendingProfiles.begin(['stranger', 'seed']));
  act(() => mockCache.pendingProfiles.end(['stranger', 'seed']));
  expect(missing.result.current.status).toBe('absent');
  expect(seeded.result.current.status).toBe('cached');
});

it('backfills idle seed and missing authors in one batch, then never repeats after settlement', async () => {
  let finish!: (events: facade.relay.RawRelayEvent[]) => void;
  const response = new Promise<facade.relay.RawRelayEvent[]>((resolve) => {
    finish = resolve;
  });
  const request = jest.fn(async () => ok(await response));
  mockLayer = facade.createNostrDataLayer({
    tiers: [facade.relay.createRelayTier({ connection: { request } })],
  });
  const seed = 'a'.repeat(64);
  const missing = 'b'.repeat(64);
  mockLayer.cache.ingestProfileInfos({ [seed]: { name: 'Seed' } }, 'cache');
  const seeded = renderHook(() => useProfile(seed));
  const stranger = renderHook(() => useProfile(missing));
  const duplicate = renderHook(() => useProfile(seed));
  expect(seeded.result.current.status).toBe('loading');
  expect(stranger.result.current.status).toBe('loading');
  await act(async () => {});
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith(
    [{ kinds: [0], authors: [seed, missing] }],
    expect.anything()
  );
  await act(async () => {
    finish([]);
  });
  expect(seeded.result.current.status).toBe('cached');
  expect(stranger.result.current.status).toBe('absent');
  expect(duplicate.result.current.status).toBe('cached');
  seeded.rerender(undefined);
  stranger.rerender(undefined);
  seeded.unmount();
  const remounted = renderHook(() => useProfile(seed));
  await act(async () => {});
  expect(remounted.result.current.status).toBe('cached');
  expect(request).toHaveBeenCalledTimes(1);
});

it('settles an idle seed when every metadata tier is disabled', async () => {
  mockLayer = facade.createNostrDataLayer({ tiers: [] });
  mockLayer.cache.ingestProfileInfos({ author: { name: 'Seed' } }, 'cache');
  const { result } = renderHook(() => useProfile('author'));
  expect(result.current.status).toBe('loading');
  await act(async () => {});
  expect(result.current.status).toBe('cached');
});
