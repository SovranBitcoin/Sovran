/**
 * @jest-environment node
 *
 * The search history's write limit on a query. The reader takes a query of
 * any length (0.1.3 recorded them without one); a new query longer than 2048
 * characters is not recorded at all, rather than recorded clipped, since a
 * clipped query is not what the person searched for.
 */

import { useSearchHistoryStore } from '@/shared/stores/profile/searchHistoryStore';

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));

const queries = (context: string) =>
  (useSearchHistoryStore.getState().recentSearches[context] ?? []).map((e) => e.query);

beforeEach(() => useSearchHistoryStore.setState({ recentSearches: {} }));

it('records a query of exactly 2048 characters', () => {
  useSearchHistoryStore.getState().addSearch('q'.repeat(2048), 'feed');
  expect(queries('feed')).toEqual(['q'.repeat(2048)]);
});

it('does not record a query longer than 2048 characters, and keeps the earlier ones', () => {
  useSearchHistoryStore.getState().addSearch('nutzap', 'feed');
  useSearchHistoryStore.getState().addSearch('q'.repeat(2049), 'feed');
  expect(queries('feed')).toEqual(['nutzap']);
});

it('measures the query after trimming the spaces around it', () => {
  useSearchHistoryStore.getState().addSearch(`  ${'q'.repeat(2048)}  `, 'feed');
  expect(queries('feed')).toEqual(['q'.repeat(2048)]);
});
