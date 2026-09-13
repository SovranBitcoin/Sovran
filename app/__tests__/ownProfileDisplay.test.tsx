import { act, renderHook } from '@testing-library/react-native';
import { useProfileDisplay } from '@/shared/hooks/useProfileDisplay';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { useOwnProfileMetadataStore } from '@/shared/stores/profile/ownProfileMetadataStore';
import { useProfileStore } from '@/shared/stores/global/profileStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
}));

jest.mock('@/shared/lib/nostr/useEntityCache', () => ({
  useCachedNostrProfile: () => ({
    metadata: { displayName: 'Original', picture: 'https://example.com/original', fetchedAt: 1 },
    isStale: false,
    isMissing: false,
  }),
  useProfileRecordsMany: () => new Map(),
}));
jest.mock('@/shared/lib/nostr/fetchProfiles', () => ({ fetchProfilesViaFacade: jest.fn() }));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
const own = 'a'.repeat(64);
const other = 'b'.repeat(64);
beforeEach(() => {
  useProfileStore.setState({
    activeAccountIndex: 0,
    profiles: [
      {
        pubkey: own,
        accountIndex: 0,
        addedAt: 0,
        cachedDisplayName: 'Original',
        cachedPicture: 'https://example.com/original',
      },
      { pubkey: other, accountIndex: 1, addedAt: 0, cachedDisplayName: 'Other' },
    ],
  });
  useOwnProfileMetadataStore.setState({ latest: null, optimistic: null });
});
it('updates both own display surfaces and reverses an optimistic picture removal without touching caches', async () => {
  const { result } = renderHook(() => ({
    display: useProfileDisplay(own),
    profile: useNostrProfileMetadata(own),
  }));
  await act(async () =>
    useOwnProfileMetadataStore
      .getState()
      .setOptimistic({ name: 'Pending', picture: null, createdAt: 2, eventId: 'c'.repeat(64) })
  );
  expect(result.current.display).toEqual({ displayName: 'Pending', picture: undefined });
  expect(result.current.profile.metadata).toMatchObject({
    displayName: 'Pending',
    picture: undefined,
  });
  expect(useProfileStore.getState().profiles[0].cachedDisplayName).toBe('Original');
  await act(async () => useOwnProfileMetadataStore.getState().clearOptimistic('c'.repeat(64)));
  expect(result.current.display).toEqual({
    displayName: 'Original',
    picture: 'https://example.com/original',
  });
  expect(result.current.profile.metadata?.picture).toBe('https://example.com/original');
});
it('does not overlay other users or inactive accounts', async () => {
  await act(async () =>
    useOwnProfileMetadataStore
      .getState()
      .setOptimistic({ name: 'Pending', picture: null, createdAt: 2, eventId: 'c'.repeat(64) })
  );
  const { result } = renderHook(() => ({
    display: useProfileDisplay(other),
    profile: useNostrProfileMetadata(other),
  }));
  expect(result.current.display.displayName).toBe('Other');
  expect(result.current.profile.metadata?.displayName).toBe('Original');
});
