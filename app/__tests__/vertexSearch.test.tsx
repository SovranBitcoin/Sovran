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
  useContactSearch: () => ({
    results: mockRows,
    status: 'ready',
    hasSearched: true,
    searchLoading: false,
    partial: false,
    error: null,
    retry: jest.fn(),
  }),
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
  expect(mockRefresh).toHaveBeenCalledTimes(1);
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
  expect(fresh.results).toHaveLength(3);
  // The refreshed score lands on its row; the painted order does not move.
  expect(fresh.results.map((r) => r.pubkey)).toEqual([C, B, A]);
  expect(fresh.results.find((r) => r.pubkey === A)?.score).toBe(1);
});
it('keeps contact keys tied to pubkeys when refreshed scores reorder results', () => {
  mockRows = [A, C].map((pubkey) => ({ pubkey, profile: { pubkey } }));
  const { result, rerender } = renderHook(() => useOverlaidContactSearch('alice'));
  expect(result.current.contactRows.map((r) => r.id)).toEqual([`contact:${A}`, `contact:${C}`]);
  mockRows = [...mockRows].reverse();
  rerender({});
  expect(result.current.contactRows.map((r) => r.id)).toEqual([`contact:${C}`, `contact:${A}`]);
});

it.each(['primal', 'relay'])(
  'refreshes a %s fallback while retaining usable metadata and unmatched results',
  async (tier) => {
    mockSearch.mockResolvedValue(
      ok({
        tier,
        hits: [
          {
            pubkey: A,
            metadata: { displayName: 'Alice', picture: 'https://example.com/alice.jpg' },
          },
          { pubkey: B, metadata: { name: 'Bob' } },
        ],
      })
    );
    const onCached = jest.fn();
    mockRefresh.mockImplementationOnce(async () => {
      expect(onCached).toHaveBeenCalledWith(
        expect.objectContaining({
          results: expect.arrayContaining([expect.objectContaining({ displayName: 'Alice' })]),
        })
      );
      return {
        pubkeys: [A],
        providers: { [A]: { vertex: { score: 0.9 } } },
        events: [],
        order: [],
        aggregates: {},
      };
    });
    const response = (await searchProfilesViaFacade({ query: 'alice', onCached }))._unsafeUnwrap();
    expect(response.results[0]).toMatchObject({
      pubkey: A,
      displayName: 'Alice',
      picture: 'https://example.com/alice.jpg',
      score: 0.9,
    });
    expect(response.results[1]).toMatchObject({ pubkey: B, name: 'Bob' });
  }
);
it('does not erase fallback hits when the signed refresh is empty', async () => {
  mockSearch.mockResolvedValue(ok({ tier: 'primal', hits }));
  mockRefresh.mockResolvedValue({
    pubkeys: [],
    providers: {},
    events: [],
    order: [],
    aggregates: {},
  });
  expect((await searchProfilesViaFacade({ query: 'alice' }))._unsafeUnwrap().results).toHaveLength(
    3
  );
});
it('never applies a refresh completed after cancellation', async () => {
  const controller = new AbortController();
  mockSearch.mockResolvedValue(ok({ tier: 'primal', hits }));
  mockRefresh.mockImplementationOnce(async () => {
    controller.abort();
    return {
      pubkeys: [A],
      providers: { [A]: { vertex: { score: 1 } } },
      events: [],
      order: [],
      aggregates: {},
    };
  });
  const response = (
    await searchProfilesViaFacade({ query: 'alice', signal: controller.signal })
  )._unsafeUnwrap();
  expect(response.results[0].score).toBe(0);
});

describe('one search never reorders or drops a painted row', () => {
  type SearchArgs = {
    onUpdate?: (resolved: { tier: string; hits: typeof hits; vertexFresh?: boolean }) => void;
  };
  const naggScored = [
    { pubkey: A, metadata: {}, score: 0 },
    { pubkey: B, metadata: {} },
    { pubkey: C, metadata: {}, score: 0.9 },
  ];

  it('resolves with the latest merged answer, not the first-paint snapshot', async () => {
    // A slower tier settles between the facade resolving and the caller's
    // continuation running: its rows were painted and must survive the final write.
    mockSearch.mockImplementationOnce((args: SearchArgs) => {
      args.onUpdate?.({ tier: 'nagg', hits: naggScored, vertexFresh: true });
      return Promise.resolve(ok({ tier: 'relay', hits: [hits[0]] }));
    });
    const onUpdate = jest.fn();
    const final = (await searchProfilesViaFacade({ query: 'alice', onUpdate }))._unsafeUnwrap();
    expect(onUpdate.mock.calls[0][0].results.map((r: { pubkey: string }) => r.pubkey)).toEqual([
      C,
      B,
      A,
    ]);
    expect(final.results.map((r) => r.pubkey)).toEqual([C, B, A]);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('keeps the painted order when a better-ranked tier lands later, appending only newcomers', async () => {
    let onUpdate!: NonNullable<SearchArgs['onUpdate']>;
    mockSearch.mockImplementationOnce((args: SearchArgs) => {
      onUpdate = args.onUpdate!;
      return Promise.resolve(ok({ tier: 'relay', hits: [hits[0], hits[1]] })); // A, B
    });
    const D = 'd'.repeat(64);
    const painted: string[][] = [];
    mockRefresh.mockImplementationOnce(async () => {
      // nagg answers during the Vertex round-trip with scores that would sort C first.
      onUpdate({ tier: 'nagg', hits: [...naggScored, { pubkey: D, metadata: {}, score: 0.5 }] });
      return null;
    });
    const final = (
      await searchProfilesViaFacade({
        query: 'alice',
        onCached: (r) => painted.push(r.results.map((x) => x.pubkey)),
        onUpdate: (r) => painted.push(r.results.map((x) => x.pubkey)),
      })
    )._unsafeUnwrap();
    expect(painted).toEqual([
      [A, B],
      [A, B, C, D],
    ]);
    expect(final.results.map((r) => r.pubkey)).toEqual([A, B, C, D]);
  });

  it('applies refreshed Vertex scores in place without reordering or cutting painted rows', async () => {
    mockSearch.mockResolvedValueOnce(ok({ tier: 'primal', hits })); // A, B, C
    mockRefresh.mockResolvedValueOnce({
      pubkeys: [C, B],
      providers: { [C]: { vertex: { score: 1 } }, [B]: { vertex: { score: 0.7 } } },
      events: [],
      order: [],
      aggregates: {},
    });
    const final = (
      await searchProfilesViaFacade({ query: 'alice', limit: 2, onCached: jest.fn() })
    )._unsafeUnwrap();
    expect(final.results.map((r) => r.pubkey)).toEqual([A, B, C]);
    expect(final.results.map((r) => r.score)).toEqual([0, 0.7, 1]);
  });
});
