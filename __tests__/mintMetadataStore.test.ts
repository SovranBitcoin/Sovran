/* eslint-disable import/first */

// Unified mint-metadata store: legacy four-store import + per-group staleness +
// the invariant that individual review rows are never persisted (aggregate only).

const mockAsyncStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((k: string) => Promise.resolve(mockAsyncStore.get(k) ?? null)),
  setItem: jest.fn((k: string, v: string) => {
    mockAsyncStore.set(k, v);
    return Promise.resolve();
  }),
  removeItem: jest.fn((k: string) => {
    mockAsyncStore.delete(k);
    return Promise.resolve();
  }),
  multiGet: jest.fn((keys: string[]) =>
    Promise.resolve(keys.map((k) => [k, mockAsyncStore.get(k) ?? null]))
  ),
  multiRemove: jest.fn((keys: string[]) => {
    keys.forEach((k) => mockAsyncStore.delete(k));
    return Promise.resolve();
  }),
}));

import {
  migrateLegacyMintCaches,
  useMintMetadataStore,
} from '@/shared/stores/global/mintMetadataStore';
import { normalizeMintUrlKey } from '@/shared/lib/url';

const MINT = 'https://mint.example.com';
const KEY = normalizeMintUrlKey(MINT);

function envelope(state: Record<string, unknown>): string {
  return JSON.stringify({ state, version: 1 });
}

beforeEach(() => {
  mockAsyncStore.clear();
  useMintMetadataStore.setState({ byMintUrl: {}, legacyMigrated: false });
});

describe('mintMetadataStore aggregate-only invariant', () => {
  it('setReviewsAggregate stores the count, never the rows', () => {
    useMintMetadataStore.getState().setReviewsAggregate(MINT, 4.2, 7);
    const entry = useMintMetadataStore.getState().getCached(MINT)!;
    expect(entry.averageScore).toBe(4.2);
    expect(entry.reviewCount).toBe(7);
    expect(entry).not.toHaveProperty('recommendations');
  });

  it('tracks staleness per source group independently', () => {
    useMintMetadataStore.getState().setReviewsAggregate(MINT, 5, 1);
    const { isStale } = useMintMetadataStore.getState();
    expect(isStale(MINT, 'reviews')).toBe(false); // just stamped
    expect(isStale(MINT, 'audit')).toBe(true); // never stamped
    expect(isStale(MINT, 'social')).toBe(true);
    // A short window makes the just-stamped group read as stale.
    expect(isStale(MINT, 'reviews', -1)).toBe(true);
  });
});

describe('migrateLegacyMintCaches', () => {
  it('merges the four legacy blobs into one entry and drops review rows', async () => {
    mockAsyncStore.set(
      'mint-info-cache',
      envelope({
        byMintUrl: { [KEY]: { info: { name: 'Example', icon_url: 'i' }, fetchedAt: 1000 } },
      })
    );
    mockAsyncStore.set(
      'audit-mint-store',
      envelope({
        cache: {
          [KEY]: {
            auditData: {
              url: MINT,
              name: 'Example',
              state: 'OK',
              n_mints: 10,
              n_melts: 5,
              n_errors: 0,
              swaps: [{ state: 'OK', time_taken: 100 }],
            },
            mintInfo: { name: 'Example' },
            timestamp: 2000,
          },
        },
      })
    );
    mockAsyncStore.set(
      'mint-profile-store',
      envelope({ cache: { [KEY]: { followers: 42, reputation: 88, timestamp: 3000 } } })
    );
    mockAsyncStore.set(
      'kym-mint-store',
      envelope({
        cache: {
          [KEY]: { score: 4.5, recommendations: [{ score: 4 }, { score: 5 }], timestamp: 4000 },
        },
      })
    );

    await migrateLegacyMintCaches();

    const entry = useMintMetadataStore.getState().getCached(MINT)!;
    expect(entry.displayName).toBe('Example');
    expect(entry.iconUrl).toBe('i');
    expect(entry.identityAt).toBe(1000);
    expect(entry.auditState).toBe('OK');
    expect(entry.auditAt).toBe(2000);
    expect(entry.contactFollowers).toBe(42);
    expect(entry.contactReputation).toBe(88);
    expect(entry.socialAt).toBe(3000);
    // Aggregate survives; raw rows are dropped.
    expect(entry.averageScore).toBe(4.5);
    expect(entry.reviewCount).toBe(2);
    expect(entry.reviewsAt).toBe(4000);
    expect(entry).not.toHaveProperty('recommendations');

    // Latch set + old keys removed.
    expect(useMintMetadataStore.getState().legacyMigrated).toBe(true);
    expect(mockAsyncStore.has('kym-mint-store')).toBe(false);
    expect(mockAsyncStore.has('mint-info-cache')).toBe(false);
  });

  it('is idempotent — a second run is a no-op once latched', async () => {
    mockAsyncStore.set(
      'kym-mint-store',
      envelope({ cache: { [KEY]: { score: 3, recommendations: [], timestamp: 1 } } })
    );
    await migrateLegacyMintCaches();
    expect(useMintMetadataStore.getState().legacyMigrated).toBe(true);
    // Re-seed a stale blob; the latch must prevent a re-import.
    mockAsyncStore.set(
      'kym-mint-store',
      envelope({ cache: { [KEY]: { score: 9, recommendations: [], timestamp: 2 } } })
    );
    await migrateLegacyMintCaches();
    expect(useMintMetadataStore.getState().getCached(MINT)?.averageScore).toBe(3);
  });

  it('keeps fresh in-memory data written during the multiGet window (existing-wins)', async () => {
    // A live writer populated a fresh aggregate before migration ran…
    useMintMetadataStore.getState().setReviewsAggregate(MINT, 5, 10);
    // …and the legacy blob holds an OLDER value.
    mockAsyncStore.set(
      'kym-mint-store',
      envelope({ cache: { [KEY]: { score: 2, recommendations: [{}], timestamp: 1 } } })
    );
    await migrateLegacyMintCaches();
    // Existing (fresh 5) must win over legacy (2).
    expect(useMintMetadataStore.getState().getCached(MINT)?.averageScore).toBe(5);
  });
});

// Minimal DiscoverMint-shaped rows (cast to avoid importing the heavy apiClient).
type DiscoverRow = Parameters<
  ReturnType<typeof useMintMetadataStore.getState>['upsertFromDiscover']
>[0][number];

function discoverRow(overrides: Record<string, unknown>): DiscoverRow {
  const row: Record<string, unknown> = {
    mintUrl: MINT,
    averageScore: 4,
    reviewCount: 3,
    ...overrides,
  };
  return row as DiscoverRow;
}

describe('upsertFromDiscover stamps a group fresh only when it carried data', () => {
  it('does NOT stamp socialAt for a row with no follower/reputation data', () => {
    useMintMetadataStore.getState().upsertFromDiscover([discoverRow({})]);
    const { isStale, getCached } = useMintMetadataStore.getState();
    const entry = getCached(MINT)!;
    // reviews always present in discover → fresh; social absent → still stale.
    expect(entry.reviewsAt).toBeDefined();
    expect(isStale(MINT, 'reviews')).toBe(false);
    expect(entry.socialAt).toBeUndefined();
    expect(isStale(MINT, 'social')).toBe(true); // operator-profile fetch NOT suppressed
  });

  it('writes followers for display but leaves social stale when no reputation', () => {
    // A follower COUNT alone is not "social resolved": the operator-profile
    // fetch (which yields reputation) must still run, so `social` stays stale.
    useMintMetadataStore.getState().upsertFromDiscover([discoverRow({ followers: 42 })]);
    const { isStale, getCached } = useMintMetadataStore.getState();
    expect(getCached(MINT)?.contactFollowers).toBe(42); // shown immediately
    expect(getCached(MINT)?.socialAt).toBeUndefined();
    expect(isStale(MINT, 'social')).toBe(true); // operator-profile fetch NOT suppressed
  });

  it('stamps socialAt when a reputation-bearing vertexScore is present', () => {
    useMintMetadataStore
      .getState()
      .upsertFromDiscover([discoverRow({ followers: 42, vertexScore: 77 })]);
    const { isStale, getCached } = useMintMetadataStore.getState();
    expect(getCached(MINT)?.contactReputation).toBe(77);
    expect(isStale(MINT, 'social')).toBe(false);
  });

  it('never stamps identityAt (discover carries no raw NUT-06 info blob)', () => {
    useMintMetadataStore
      .getState()
      .upsertFromDiscover([discoverRow({ name: 'Mint', iconUrl: 'i' })]);
    const entry = useMintMetadataStore.getState().getCached(MINT)!;
    expect(entry.displayName).toBe('Mint'); // scalar updated…
    expect(entry.identityAt).toBeUndefined(); // …but identity not marked fresh
  });

  it('does not clobber a known reputation with a null vertexScore', () => {
    useMintMetadataStore.getState().setSocial(MINT, 10, 88);
    useMintMetadataStore.getState().upsertFromDiscover([discoverRow({ vertexScore: null })]);
    expect(useMintMetadataStore.getState().getCached(MINT)?.contactReputation).toBe(88);
  });
});
