/**
 * nostrMetadataCache is now the PERSISTENCE SIDECAR for the single profile owner
 * (the nagg-ts entity cache): it mirrors the owner's snapshot (write-behind) so
 * cold-start can boot-seed it back. The low-confidence merge / fill-missing
 * behavior moved into the entity cache (mergeProfile, tested in nagg-ts). These
 * tests cover the mapping + the persisted-snapshot action.
 */
import type { facade } from '@sovranbitcoin/nagg-ts';
import {
  cachedProfileToMetadata,
  useNostrMetadataCache,
} from '@/shared/stores/global/nostrMetadataCache';

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (e: unknown) => e,
}));

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

beforeEach(() => {
  useNostrMetadataCache.setState({ byPubkey: {} });
});

describe('cachedProfileToMetadata', () => {
  it('maps an owner record to metadata, using seenAt as fetchedAt', () => {
    const record: facade.CachedProfile = {
      pubkey: 'pk1',
      name: 'alice',
      displayName: 'Alice',
      picture: 'http://x/a.png',
      nip05: 'alice@example.com',
      seenAt: 1700,
      srcRank: 3,
    };
    expect(cachedProfileToMetadata(record)).toEqual({
      name: 'alice',
      displayName: 'Alice',
      picture: 'http://x/a.png',
      banner: undefined,
      nip05: 'alice@example.com',
      lud16: undefined,
      website: undefined,
      about: undefined,
      fetchedAt: 1700,
    });
  });

  it('maps a feed-seeded record (seenAt 0) to fetchedAt 0 → immediately stale', () => {
    const record: facade.CachedProfile = { pubkey: 'pk1', name: 'bob', seenAt: 0, srcRank: 0 };
    expect(cachedProfileToMetadata(record)?.fetchedAt).toBe(0);
  });

  it('returns undefined for an absent record', () => {
    expect(cachedProfileToMetadata(undefined)).toBeUndefined();
  });
});

describe('persistOwnerSnapshot', () => {
  it('replaces the persisted mirror with the supplied snapshot', () => {
    useNostrMetadataCache.setState({ byPubkey: { old: { name: 'gone', fetchedAt: 1 } } });
    useNostrMetadataCache.getState().persistOwnerSnapshot({
      pk1: { name: 'alice', fetchedAt: 1700 },
      pk2: { name: 'bob', fetchedAt: 1800 },
    });
    const { byPubkey } = useNostrMetadataCache.getState();
    expect(Object.keys(byPubkey).sort()).toEqual(['pk1', 'pk2']); // 'old' replaced
    expect(byPubkey.pk1.name).toBe('alice');
  });
});
