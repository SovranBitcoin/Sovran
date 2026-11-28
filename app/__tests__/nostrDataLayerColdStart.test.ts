/**
 * @jest-environment node
 *
 * Cold start of the profile cache (audit D3, D4): what a layer built before or
 * after the saved mirror has been read paints, what it refetches, and what the
 * write-behind is allowed to save. Same harness as nostrDataLayerMirror.test.ts:
 * the real data layer, entity cache and metadata store over an in-memory disk.
 */
import type { facade } from 'nostr';

import { accountHolders } from '@/shared/lib/account/accountRegistry';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import { useNostrMetadataCache } from '@/shared/stores/global/nostrMetadataCache';

const SAVED = Array.from({ length: 50 }, (_, index) => index.toString(16).padStart(64, '0'));
const NEW_CONTACT = 'f'.repeat(64);
const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

const mockDisk = new Map<string, string>();
/** Holds the store's read of the disk open, as a slow AsyncStorage does. */
let mockReleaseRead: (() => void) | null = null;
let mockHoldReads = false;

jest.mock('@/shared/lib/logger', () => ({
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  storeLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));
jest.mock('@/shared/lib/nostr/nostrTierConfig', () => ({
  getNostrTierConfig: () => ({
    primal: { enabled: false, urls: [] },
    relay: { enabled: true, relays: ['wss://relay.invalid'] },
  }),
}));
jest.mock('@/shared/stores/global/profileStore', () => {
  const useProfileStore = {
    getState: () => ({ getActiveProfile: () => ({ pubkey: 'a'.repeat(64) }) }),
  };
  return {
    useProfileStore,
    ...jest
      .requireActual<typeof import('./helpers/profileStoreMock')>('./helpers/profileStoreMock')
      .activeAccountReaders(() => useProfileStore.getState()),
  };
});
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async (key: string) => {
      if (mockHoldReads) await new Promise<void>((resolve) => (mockReleaseRead = resolve));
      return mockDisk.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => void mockDisk.set(key, value),
    removeItem: async (key: string) => void mockDisk.delete(key),
  }),
}));

const dataLayerHolder = () => accountHolders.find((entry) => entry.name === 'nostr.data-layer')!;

function layer(): facade.NostrDataLayer {
  const built = buildNostrDataLayer();
  if (!built) throw new Error('No data layer was built');
  return built;
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function saveToDisk(entries: Record<string, unknown>) {
  mockDisk.set(
    'nostr-metadata-cache',
    JSON.stringify({ state: { byPubkey: entries }, version: 0 })
  );
}

const savedEntries = (fetchedAt: number) =>
  Object.fromEntries(
    SAVED.map((pubkey, index) => [
      pubkey,
      {
        name: `saved-${index}`,
        lud16: `u${index}@example.com`,
        fetchedAt,
        createdAt: 1_700_000_000 + index,
      },
    ])
  );

const diskEntries = () =>
  JSON.parse(mockDisk.get('nostr-metadata-cache') ?? '{"state":{"byPubkey":{}}}').state
    .byPubkey as Record<string, { name?: string }>;

beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  mockHoldReads = false;
  mockReleaseRead = null;
  await dataLayerHolder().dispose();
  mockDisk.clear();
  useNostrMetadataCache.setState({ byPubkey: {} });
  await useNostrMetadataCache.persist.rehydrate();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('a saved profile keeps its age across a cold start (D3)', () => {
  it('50 saved profiles fetched an hour ago are painted and none is refetched', async () => {
    saveToDisk(savedEntries(NOW - HOUR));
    await useNostrMetadataCache.persist.rehydrate();
    const built = layer();
    for (const pubkey of SAVED) {
      expect(built.cache.profiles.peek(pubkey)).toMatchObject({ fetchedAt: NOW - HOUR });
    }
    expect(built.ensureProfiles(SAVED)).toEqual([]);
  });

  it('only the profiles past the 24 h window are revalidated', async () => {
    const entries = savedEntries(NOW - HOUR);
    (entries[SAVED[0]!] as { fetchedAt: number }).fetchedAt = NOW - 25 * HOUR;
    (entries[SAVED[1]!] as { fetchedAt: number }).fetchedAt = 0;
    saveToDisk(entries);
    await useNostrMetadataCache.persist.rehydrate();
    expect(layer().ensureProfiles(SAVED).sort()).toEqual([SAVED[0], SAVED[1]].sort());
  });

  it('a saved event time is the merge order: an older copy fetched later does not replace it', async () => {
    saveToDisk(savedEntries(NOW - HOUR));
    await useNostrMetadataCache.persist.rehydrate();
    const built = layer();
    built.cache.ingestProfileMetadata(
      { [SAVED[3]!]: { name: 'older', lud16: 'old@example.com' } },
      1,
      'primal',
      {
        createdAt: { [SAVED[3]!]: 1_600_000_000 },
      }
    );
    expect(built.cache.profiles.peek(SAVED[3]!)).toMatchObject({
      name: 'saved-3',
      lud16: 'u3@example.com',
    });
  });

  it('the event time survives the round trip to disk', async () => {
    const built = layer();
    built.cache.ingestProfileMetadata({ [NEW_CONTACT]: { name: 'new' } }, 1, 'relay', {
      createdAt: { [NEW_CONTACT]: 1_750_000_000 },
    });
    jest.advanceTimersByTime(5_000);
    await settle();
    expect(diskEntries()[NEW_CONTACT]).toMatchObject({
      name: 'new',
      createdAt: 1_750_000_000,
      fetchedAt: NOW,
    });
  });

  it('an entry saved before event times were kept still loads, as a seed any fetch replaces', async () => {
    saveToDisk({
      [SAVED[0]!]: { name: 'legacy entry', lud16: 'legacy@example.com', fetchedAt: NOW - HOUR },
    });
    await useNostrMetadataCache.persist.rehydrate();
    const built = layer();
    expect(built.cache.profiles.peek(SAVED[0]!)).toMatchObject({ name: 'legacy entry', seenAt: 0 });
    built.cache.ingestProfileMetadata({ [SAVED[0]!]: { name: 'fetched' } }, 1, 'relay', {
      createdAt: { [SAVED[0]!]: 1_700_000_000 },
    });
    expect(built.cache.profiles.peek(SAVED[0]!)?.name).toBe('fetched');
    expect(built.cache.profiles.peek(SAVED[0]!)?.lud16).toBeUndefined();
  });
});

describe('a layer built before the saved mirror has been read (D4)', () => {
  async function buildBeforeRead() {
    saveToDisk(savedEntries(NOW - HOUR));
    mockHoldReads = true;
    const reading = useNostrMetadataCache.persist.rehydrate();
    await settle();
    expect(useNostrMetadataCache.persist.hasHydrated()).toBe(false);
    const built = layer();
    return { built, reading };
  }

  it('paints the saved profiles as soon as the read finishes', async () => {
    const { built, reading } = await buildBeforeRead();
    expect(built.cache.profiles.peek(SAVED[0]!)).toBeUndefined();
    mockReleaseRead?.();
    await reading;
    await settle();
    for (const pubkey of SAVED) expect(built.cache.profiles.peek(pubkey)).toBeDefined();
    expect(built.ensureProfiles(SAVED)).toEqual([]);
  });

  it('does not write while the mirror is unread, so the saved 50 are not replaced by 1', async () => {
    const { built, reading } = await buildBeforeRead();
    built.cache.ingestProfileMetadata({ [NEW_CONTACT]: { name: 'new' } }, 1, 'relay', {
      createdAt: { [NEW_CONTACT]: 1_750_000_000 },
    });
    jest.advanceTimersByTime(5_000);
    await settle();
    expect(Object.keys(diskEntries())).toHaveLength(50);

    mockReleaseRead?.();
    await reading;
    await settle();
    jest.advanceTimersByTime(5_000);
    await settle();
    const saved = diskEntries();
    expect(Object.keys(saved)).toHaveLength(51);
    expect(saved[NEW_CONTACT]).toMatchObject({ name: 'new' });
    expect(saved[SAVED[7]!]).toMatchObject({ name: 'saved-7' });
  });

  it('a write never drops a saved profile the cache does not hold', async () => {
    saveToDisk(savedEntries(NOW - HOUR));
    await useNostrMetadataCache.persist.rehydrate();
    const built = layer();
    // The cache lost one (LRU eviction); the mirror still has it.
    built.cache.profiles.delete(SAVED[9]!);
    built.cache.ingestProfileMetadata({ [NEW_CONTACT]: { name: 'new' } }, 1, 'relay');
    jest.advanceTimersByTime(5_000);
    await settle();
    expect(diskEntries()[SAVED[9]!]).toMatchObject({ name: 'saved-9' });
    expect(Object.keys(diskEntries())).toHaveLength(51);
  });

  it('seeding from the mirror is not itself written back', async () => {
    saveToDisk(savedEntries(NOW - HOUR));
    await useNostrMetadataCache.persist.rehydrate();
    const before = mockDisk.get('nostr-metadata-cache');
    const setItem = jest.spyOn(mockDisk, 'set');
    layer();
    jest.advanceTimersByTime(10_000);
    await settle();
    expect(setItem).not.toHaveBeenCalled();
    expect(mockDisk.get('nostr-metadata-cache')).toBe(before);
  });
});
