/* eslint-disable import/first */

// Pure merge that overlays the unified cache onto colada's base selector rows.
// Locks the load-bearing invariants: cache never paints funds/availability;
// `live ?? cache` after enrichment vs `cache ?? base` before; cold/cached/live
// tagging; and that a terminal `failed` status keeps rows selectable.

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
  multiGet: jest.fn(() => Promise.resolve([])),
  multiRemove: jest.fn(() => Promise.resolve()),
}));

import { resolveMintRows } from '@/features/mint/hooks/useMintRowsWithCache';
import type { MintMetadataEntry } from '@/shared/stores/global/mintMetadataTypes';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import type { MintListItem } from 'wallet';

const URL = 'https://mint.example.com';

function base(overrides: Partial<MintListItem> = {}): MintListItem {
  return {
    mintUrl: URL,
    displayName: URL,
    balance: 1234,
    unit: 'sat',
    status: 'available',
    reason: null,
    isPreferred: false,
    ...overrides,
  };
}

function cacheOf(entry: MintMetadataEntry): Record<string, MintMetadataEntry> {
  return { [normalizeMintUrlKey(URL)]: entry };
}

describe('resolveMintRows', () => {
  it('is cold (skeleton) when not enriched and no cache exists', () => {
    const { rows, allCold } = resolveMintRows({
      baseItems: [base()],
      itemsStatus: 'loading',
      byMintUrl: {},
    });
    expect(rows[0].metaState).toBe('cold');
    expect(allCold).toBe(true);
  });

  it('cached: cache name/icon/scores win over the base url before enrichment', () => {
    const { rows } = resolveMintRows({
      baseItems: [base({ displayName: URL })],
      itemsStatus: 'loading',
      byMintUrl: cacheOf({
        displayName: 'Sovran Mint',
        iconUrl: 'https://i',
        averageScore: 4.5,
        reviewCount: 12,
      }),
    });
    expect(rows[0].metaState).toBe('cached');
    expect(rows[0].displayName).toBe('Sovran Mint');
    expect(rows[0].iconUrl).toBe('https://i');
    expect(rows[0].kymScore).toBe(4.5);
    expect(rows[0].reviewCount).toBe(12);
  });

  it('live: base wins outright once enriched; cache only fills holes', () => {
    const { rows } = resolveMintRows({
      baseItems: [base({ displayName: 'Live Name', kymScore: 3 })],
      itemsStatus: 'ready',
      byMintUrl: cacheOf({ displayName: 'Cached Name', averageScore: 4.5, contactFollowers: 50 }),
    });
    expect(rows[0].metaState).toBe('live');
    expect(rows[0].displayName).toBe('Live Name'); // base wins
    expect(rows[0].kymScore).toBe(3); // base wins
    expect(rows[0].contactFollowers).toBe(50); // hole filled from cache
  });

  it('preserves a fresh live 0 over a cached non-zero score', () => {
    const { rows } = resolveMintRows({
      baseItems: [base({ kymScore: 0 })],
      itemsStatus: 'ready',
      byMintUrl: cacheOf({ averageScore: 4.5 }),
    });
    expect(rows[0].kymScore).toBe(0);
  });

  it('treats a terminal `failed` status as done — rows are live + selectable, not cold', () => {
    const { rows, allCold } = resolveMintRows({
      baseItems: [base()],
      itemsStatus: 'failed',
      byMintUrl: {},
    });
    expect(rows[0].metaState).toBe('live');
    expect(rows[0].status).toBe('available'); // user can still pick the mint
    expect(allCold).toBe(false);
  });

  it('never sources balance / status / isPreferred / worksOffline from cache', () => {
    const { rows } = resolveMintRows({
      baseItems: [
        base({ balance: 999, status: 'available', isPreferred: true, worksOffline: true }),
      ],
      itemsStatus: 'loading',
      byMintUrl: cacheOf({ displayName: 'X' }),
    });
    expect(rows[0].balance).toBe(999);
    expect(rows[0].status).toBe('available');
    expect(rows[0].isPreferred).toBe(true);
    expect(rows[0].worksOffline).toBe(true);
  });
});
