/* eslint-disable import/first */
// The retired nagg changelog cache stays declared under its released name, so
// an install that cached the feed still loads and keeps that row (ADR 0036).

const mockDisk = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockDisk.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mockDisk.set(key, value);
    },
    removeItem: async (key: string) => {
      mockDisk.delete(key);
    },
  },
}));

import { MINT_CHANGES_CACHE_KEY, mintChangesCache } from '@/features/mint/data/mintChangesCache';

it('loads a row 0.1.2 saved, unchanged, under the released key', async () => {
  const row = {
    state: {
      byKey: {
        global: {
          data: { trackedMints: 1, reachableMints: 1, totalChanges: 0, changes: [] },
          fetchedAt: 1_700_000_000_000,
          viewerKey: '',
        },
      },
    },
    version: 1,
  };
  mockDisk.set('mint-changes-cache', JSON.stringify(row));
  // The query-cache type hides zustand's persist API; the store is persisted.
  const cached = mintChangesCache.useCacheState as unknown as {
    persist: { rehydrate: () => Promise<void> };
  };
  await cached.persist.rehydrate();
  expect(mintChangesCache.getEntry(MINT_CHANGES_CACHE_KEY)?.data).toEqual(
    row.state.byKey.global.data
  );
  expect(mockDisk.get('mint-changes-cache')).toBeDefined();
});
