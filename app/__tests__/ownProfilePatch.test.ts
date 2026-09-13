import {
  applyProfilePatch,
  nextProfileCreatedAt,
} from '@/shared/lib/nostr/profile/publishOwnProfileMetadata';
jest.mock('@/shared/lib/logger', () => ({
  nostrLog: { info: jest.fn(), warn: jest.fn() },
  storeLog: { warn: jest.fn() },
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  withSkippedPersistWrites: (fn: () => void) => fn(),
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: {
    getState: () => ({
      getActiveProfile: () => ({ pubkey: 'a'.repeat(64), accountIndex: 0 }),
      updateProfileMetadata: mockUpdate,
    }),
    subscribe: jest.fn(() => () => {}),
  },
}));
const mockUpdate = jest.fn();
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => ({
    cache: { profiles: { delete: mockDelete }, ingestProfileMetadata: mockIngest },
  }),
}));
const mockIngest = jest.fn();
const mockDelete = jest.fn();
jest.mock('@/shared/lib/nostr/publish/publishEvent', () => ({ publishEvent: jest.fn() }));
jest.mock('@/shared/lib/nostr/outbox/relayListStore', () => ({ getOwnWriteRelays: () => [] }));
jest.mock(
  '@nostr-dev-kit/ndk-mobile',
  () => ({
    __esModule: true,
    default: jest.fn(),
    normalizeRelayUrl: (url: string) => url,
    NDKEvent: class {
      id = 'e'.repeat(64);
      sign = jest.fn(async () => {});
    },
  }),
  { virtual: true }
);

it('preserves unknown keys and untouched metadata', () => {
  const base = {
    lud16: 'a@b',
    nip05: 'a@b',
    about: 'Bio',
    banner: 'banner',
    website: 'site',
    custom: { nested: [1, false] },
  };
  expect(applyProfilePatch(base, { name: 'New' })).toEqual({
    ...base,
    name: 'New',
    display_name: 'New',
  });
  expect(base).not.toHaveProperty('name');
});
it.each([
  [{ display_name: 'Old' }, 'New'],
  [{ name: 'Old', display_name: 'Old' }, 'New'],
  [{ name: 'handle', display_name: 'Old' }, 'handle'],
])('syncs only absent or matching handles: %j', (base, expected) => {
  expect(applyProfilePatch(base, { name: 'New' })).toMatchObject({
    name: expected,
    display_name: 'New',
  });
});
it('removes the picture key and preserves the original object', () => {
  const base = { picture: 'https://example.com/avatar', name: 'handle' };
  expect(applyProfilePatch(base, { picture: null })).toEqual({ name: 'handle' });
  expect(base.picture).toBeTruthy();
});
it('keeps created_at monotonic even with clock skew or same-second saves', () => {
  expect(nextProfileCreatedAt(100, 50)).toBe(101);
  expect(nextProfileCreatedAt(100, 100)).toBe(101);
  expect(nextProfileCreatedAt(100, 120)).toBe(120);
});
