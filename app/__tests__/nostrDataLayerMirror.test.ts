/**
 * @jest-environment node
 *
 * The data layer's durable mirror: what the shared profile cache writes to
 * the persisted `nostr-metadata-cache` store and when, and what a later build
 * reads back from it. The real data layer, entity cache and metadata store
 * run; storage is an in-memory map behind the profile-scoped adapter, and the
 * tier config and active profile are fixed. Account ownership of the mirror is
 * pinned by nostrDataLayerRebuild.test.ts.
 */
import type { facade } from 'nostr';

import { accountHolders } from '@/shared/lib/account/accountRegistry';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import { useNostrMetadataCache } from '@/shared/stores/global/nostrMetadataCache';

const ACCOUNT = 'a'.repeat(64);
const CONTACT = 'c'.repeat(64);
const OTHER = 'd'.repeat(64);
// A fixture an older build injected (see legacyMockProfiles.ts).
const LEGACY = '1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2';
const LEGACY_META = { name: 'satoshi', about: 'Just a guy who likes peer-to-peer cash.' };

const mockDisk = new Map<string, string>();
const mockSetItem = jest.fn(async (key: string, value: string) => void mockDisk.set(key, value));

let mockOwnProfile: Record<string, unknown> | null = { pubkey: ACCOUNT };

jest.mock('@/shared/lib/logger', () => ({
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  storeLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));
jest.mock('@/shared/lib/nostr/nostrTierConfig', () => ({
  getNostrTierConfig: () => ({
    nagg: { enabled: true, appViewBaseUrl: 'https://nagg.invalid' },
    primal: { enabled: false, urls: [] },
    relay: { enabled: false, relays: [] },
  }),
}));
jest.mock('@/shared/stores/global/profileStore', () => {
  const useProfileStore = { getState: () => ({ getActiveProfile: () => mockOwnProfile }) };
  return {
    useProfileStore,
    ...jest
      .requireActual<typeof import('./helpers/profileStoreMock')>('./helpers/profileStoreMock')
      .activeAccountReaders(() => useProfileStore.getState()),
  };
});
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async (key: string) => mockDisk.get(key) ?? null,
    setItem: (key: string, value: string) => mockSetItem(key, value),
    removeItem: async (key: string) => void mockDisk.delete(key),
  }),
}));

const dataLayerHolder = () => accountHolders.find((entry) => entry.name === 'nostr.data-layer')!;

function layer(): facade.NostrDataLayer {
  const built = buildNostrDataLayer();
  if (!built) throw new Error('No data layer was built');
  return built;
}

const mirrored = () => useNostrMetadataCache.getState().byPubkey;

beforeEach(async () => {
  jest.useFakeTimers();
  await dataLayerHolder().dispose();
  mockDisk.clear();
  mockSetItem.mockClear();
  mockOwnProfile = { pubkey: ACCOUNT };
  useNostrMetadataCache.setState({ byPubkey: {} });
  mockSetItem.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('what is mirrored and when', () => {
  it('writes the cached profiles once, five seconds after the first change', () => {
    const built = layer();
    built.cache.ingestProfileMetadata(
      { [CONTACT]: { name: 'carl', picture: 'https://p/c.png', nip05: 'c@x' } },
      100,
      'cache'
    );
    jest.advanceTimersByTime(4_000);
    built.cache.ingestProfileMetadata({ [OTHER]: { name: 'dora' } }, 101, 'cache');
    jest.advanceTimersByTime(999);
    expect(mirrored()).toEqual({});

    jest.advanceTimersByTime(1);
    expect(mirrored()).toEqual({
      [CONTACT]: expect.objectContaining({
        name: 'carl',
        picture: 'https://p/c.png',
        nip05: 'c@x',
      }),
      [OTHER]: expect.objectContaining({ name: 'dora' }),
    });
  });

  it('reaches durable storage, and a reload of the store reads it back', async () => {
    // The store hydrates at app start before anything writes to it.
    await useNostrMetadataCache.persist.rehydrate();
    const built = layer();
    built.cache.ingestProfileMetadata({ [CONTACT]: { name: 'carl' } }, 100, 'cache');
    jest.advanceTimersByTime(5_000);
    for (let i = 0; i < 10; i++) await Promise.resolve();

    const blob = mockDisk.get('nostr-metadata-cache') ?? 'null';
    expect(JSON.parse(blob)?.state?.byPubkey?.[CONTACT]).toMatchObject({ name: 'carl' });

    // A cold start: memory is empty, the saved blob is what is on disk.
    useNostrMetadataCache.setState({ byPubkey: {} });
    mockDisk.set('nostr-metadata-cache', blob);
    await useNostrMetadataCache.persist.rehydrate();
    expect(mirrored()[CONTACT]).toMatchObject({ name: 'carl' });
  });

  it('never mirrors a legacy fixture profile', () => {
    const built = layer();
    built.cache.ingestProfileMetadata(
      { [LEGACY]: LEGACY_META, [CONTACT]: { name: 'carl' } },
      100,
      'cache'
    );
    jest.advanceTimersByTime(5_000);
    expect(Object.keys(mirrored())).toEqual([CONTACT]);
  });

  it('mirrors the own cached name seeded at build once anything else changes', () => {
    mockOwnProfile = {
      pubkey: ACCOUNT,
      cachedDisplayName: 'Me',
      cachedPicture: 'https://p/me.png',
    };
    const built = layer();
    built.cache.ingestProfileMetadata({ [CONTACT]: { name: 'carl' } }, 100, 'cache');
    jest.advanceTimersByTime(5_000);
    expect(mirrored()[ACCOUNT]).toMatchObject({ name: 'Me', picture: 'https://p/me.png' });
  });
});

describe('what a build reads back', () => {
  it('seeds the cache from the mirror at low confidence, so any fetched profile wins', () => {
    useNostrMetadataCache.setState({
      byPubkey: { [CONTACT]: { name: 'from disk', fetchedAt: 1_700 } },
    });
    const built = layer();
    expect(built.cache.profiles.get(CONTACT)).toMatchObject({ name: 'from disk', seenAt: 0 });

    built.cache.ingestProfileMetadata({ [CONTACT]: { name: 'fetched' } }, 1, 'cache');
    expect(built.cache.profiles.get(CONTACT)).toMatchObject({ name: 'fetched' });
  });

  it('does not seed a legacy fixture profile from the mirror', () => {
    useNostrMetadataCache.setState({
      byPubkey: {
        [LEGACY]: { ...LEGACY_META, fetchedAt: 1 },
        [CONTACT]: { name: 'c', fetchedAt: 1 },
      },
    });
    const built = layer();
    expect(built.cache.profiles.get(LEGACY)).toBeUndefined();
    expect(built.cache.profiles.get(CONTACT)).toBeDefined();
  });

  it('reads the mirror only when the layer is built, not on later store changes', () => {
    const built = layer();
    useNostrMetadataCache.setState({ byPubkey: { [CONTACT]: { name: 'late', fetchedAt: 1 } } });
    expect(built.cache.profiles.get(CONTACT)).toBeUndefined();
    expect(buildNostrDataLayer()).toBe(built);
    expect(built.cache.profiles.get(CONTACT)).toBeUndefined();
  });
});
