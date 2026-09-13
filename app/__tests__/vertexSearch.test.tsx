import { renderHook } from '@testing-library/react-native';
import { ok } from 'neverthrow';
import { searchProfilesViaFacade } from '@/shared/lib/nostr/searchProfiles';
import { useOverlaidContactSearch } from '@/features/contacts/hooks/useOverlaidContactSearch';

const mockSearch = jest.fn();
const mockRefresh = jest.fn();
let mockRows: { pubkey: string; profile: { pubkey: string } }[] = [];
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => ({ searchProfiles: mockSearch }),
}));
jest.mock('@/shared/lib/nostr/vertex/refreshVertex', () => ({
  refreshVertex: (...args: unknown[]) => mockRefresh(...args),
}));
jest.mock('@/features/payments/hooks/useContactSearch', () => ({
  useContactSearch: () => ({ displayResults: mockRows, hasSearched: true, searchLoading: false }),
}));
jest.mock('@/shared/hooks/useNostrProfileMetadata', () => ({
  useNostrProfileMetadataMany: () => ({ metadata: new Map() }),
}));
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const hits = [
  { pubkey: A, metadata: {}, score: 0 },
  { pubkey: B, metadata: {} },
  { pubkey: C, metadata: {}, score: 0.9 },
];
beforeEach(() => {
  mockSearch.mockReset();
  mockRefresh.mockReset().mockResolvedValue(null);
});

it('sorts scored nagg hits descending, preserving unknown slots and relay API order', async () => {
  mockSearch
    .mockResolvedValueOnce(ok({ tier: 'nagg', hits, vertexFresh: true }))
    .mockResolvedValueOnce(ok({ tier: 'relay', hits }));
  const nagg = (await searchProfilesViaFacade({ query: 'alice' }))._unsafeUnwrap();
  expect(nagg.results.map((r) => r.pubkey)).toEqual([C, B, A]);
  const relay = (await searchProfilesViaFacade({ query: 'alice' }))._unsafeUnwrap();
  expect(relay.results.map((r) => r.pubkey)).toEqual([A, B, C]);
  expect(mockRefresh).not.toHaveBeenCalled();
});
it('refreshes an explicitly stale nagg page and retains it on failure', async () => {
  mockSearch.mockResolvedValue(ok({ tier: 'nagg', hits, vertexFresh: false }));
  const onCached = jest.fn();
  mockRefresh.mockImplementationOnce(async () => {
    expect(onCached).toHaveBeenCalledTimes(1);
    return null;
  });
  const stale = (
    await searchProfilesViaFacade({ query: ' ALICE ', limit: 10, onCached })
  )._unsafeUnwrap();
  expect(stale.results).toHaveLength(3);
  expect(mockRefresh).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'search', query: 'alice', stale: true, limit: 10 })
  );
  mockRefresh.mockResolvedValue({
    pubkeys: [A],
    providers: { [A]: { vertex: { score: 1 } } },
    events: [],
    order: [],
    aggregates: {},
  });
  const fresh = (await searchProfilesViaFacade({ query: 'alice' }))._unsafeUnwrap();
  expect(fresh.results).toHaveLength(1);
  expect(fresh.results[0].score).toBe(1);
});
it('keeps contact keys tied to pubkeys when refreshed scores reorder results', () => {
  mockRows = [A, C].map((pubkey) => ({ pubkey, profile: { pubkey } }));
  const { result, rerender } = renderHook(() => useOverlaidContactSearch('alice'));
  expect(result.current.contactRows.map((r) => r.id)).toEqual([`contact:${A}`, `contact:${C}`]);
  mockRows = [...mockRows].reverse();
  rerender({});
  expect(result.current.contactRows.map((r) => r.id)).toEqual([`contact:${C}`, `contact:${A}`]);
});
