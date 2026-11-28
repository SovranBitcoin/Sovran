import { act, renderHook } from '@testing-library/react-native';
import { facade } from 'nostr';
import { useProfileRecordsMany } from '@/shared/lib/nostr/useEntityCache';

let mockCache: facade.NostrEntityCache;
let mockStore: facade.NormalizingStore<facade.CachedProfile>;
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => ({ cache: { ...mockCache, profiles: mockStore } }),
}));

beforeEach(() => {
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
