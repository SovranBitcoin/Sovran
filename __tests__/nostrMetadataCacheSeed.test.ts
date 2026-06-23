/**
 * Unit tests for nostrMetadataCache's low-confidence seed — the single-profile-
 * cache path that nagg feed profiles (and search results) flow through. It must
 * never clobber authoritative relay kind-0 data, only fill gaps, and mark new
 * entries immediately stale so a real fetch still runs.
 */
import { useNostrMetadataCache } from '@/shared/stores/global/nostrMetadataCache';

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

describe('seedManyProfilesLowConfidence', () => {
  it('inserts a new profile as immediately stale (fetchedAt: 0)', () => {
    useNostrMetadataCache.getState().seedManyProfilesLowConfidence({
      pk1: { name: 'alice', picture: 'http://x/a.png' },
    });
    const entry = useNostrMetadataCache.getState().byPubkey.pk1;
    expect(entry.name).toBe('alice');
    expect(entry.fetchedAt).toBe(0); // stale → a real kind-0 fetch still runs
  });

  it('never clobbers existing (relay-authoritative) fields; only fills gaps', () => {
    // Authoritative relay kind-0: rich displayName, freshly fetched.
    useNostrMetadataCache.getState().setProfile('pk1', {
      displayName: 'Alice (verified)',
      nip05: 'alice@example.com',
    });
    const before = useNostrMetadataCache.getState().byPubkey.pk1;

    // nagg low-confidence seed brings a name + picture.
    useNostrMetadataCache.getState().seedManyProfilesLowConfidence({
      pk1: { name: 'alice', picture: 'http://x/a.png' },
    });

    const after = useNostrMetadataCache.getState().byPubkey.pk1;
    expect(after.displayName).toBe('Alice (verified)'); // authoritative field untouched
    expect(after.nip05).toBe('alice@example.com');
    expect(after.picture).toBe('http://x/a.png'); // gap filled
    expect(after.fetchedAt).toBe(before.fetchedAt); // freshness preserved, not reset to 0
  });

  it('is a no-op when the seed adds nothing new', () => {
    useNostrMetadataCache.getState().setProfile('pk1', { name: 'alice', picture: 'p' });
    const before = useNostrMetadataCache.getState().byPubkey;
    useNostrMetadataCache.getState().seedManyProfilesLowConfidence({ pk1: { name: 'alice' } });
    expect(useNostrMetadataCache.getState().byPubkey).toBe(before); // same reference, no write
  });

  it('seedFromSearchResults delegates to the same low-confidence path', () => {
    useNostrMetadataCache
      .getState()
      .seedFromSearchResults([{ pubkey: 'pk2', profile: { name: 'bob' } }]);
    expect(useNostrMetadataCache.getState().byPubkey.pk2.fetchedAt).toBe(0);
  });
});
