import { act, renderHook } from '@testing-library/react-native';
import { facade } from 'nostr';
import { DEMO_FEED, DEMO_PROFILES } from '@/shared/stores/runtime/mockPresentationData';
import { useProfile, useProfileRecordsMany } from '@/shared/lib/nostr/useEntityCache';

let mockMode = false;
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (selector: (state: { mockMode: boolean }) => unknown) => selector({ mockMode }),
}));
let mockStore: facade.NormalizingStore<facade.CachedProfile>;
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => ({ cache: { profiles: mockStore } }),
}));

beforeEach(() => {
  mockMode = false;
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
