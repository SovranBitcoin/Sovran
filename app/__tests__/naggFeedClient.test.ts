jest.mock('wallet', () => ({
  combineSignals: (...signals: (AbortSignal | undefined)[]) =>
    signals.find((signal): signal is AbortSignal => !!signal) ?? new AbortController().signal,
  createNostrMintEnrichment: jest.fn(() => ({
    fetchMintReviews: jest.fn(),
    resolveMintContactProfile: jest.fn(),
  })),
  isAbortError: () => false,
  timeoutSignal: () => new AbortController().signal,
}));

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

// The nagg client is app-view (REST) only — these tests mock fetch returning the
// v2 generic envelopes nagg emits (`{ order, orderBy, events, aggregates }`),
// and assert the client reconstructs them and hits the right `/v1/nostr/*` route.

const ENV_KEYS = [
  'EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL',
  'EXPO_PUBLIC_NAGG_BASE_URL',
  'EXPO_PUBLIC_SCORE_API_BASE_URL',
  'EXPO_PUBLIC_NOSTR_GRAPHQL_ENDPOINT',
] as const;

const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const mockFetch = jest.fn();

const restResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: async () => body,
});

// Ids and public keys as they are on the wire: 64 lowercase hex characters.
const ROOT = '1'.repeat(64);
const Q1 = '5'.repeat(64);
const ALICE = 'a'.repeat(64);
const DAVE = 'd'.repeat(64);

const note = (overrides: Record<string, unknown> = {}) => ({
  id: ROOT,
  kind: 1,
  pubkey: ALICE,
  content: 'hello',
  tags: [] as string[][],
  created_at: 100,
  ...overrides,
});

// A kind-0 profile event — v2 envelopes hydrate profiles as raw kind-0 events,
// not a server-built `profiles` side map.
const profileEvent = (pubkey: string, name: string) =>
  note({ id: `f${pubkey.slice(1)}`, kind: 0, pubkey, content: JSON.stringify({ name }) });

function loadClient() {
  const { createNaggFeedClient } = jest.requireActual<
    typeof import('@/features/feed/data/naggFeedClient')
  >('@/features/feed/data/naggFeedClient');
  return createNaggFeedClient();
}

describe('createNaggFeedClient (app-view REST)', () => {
  beforeEach(() => {
    jest.resetModules();
    mockFetch.mockReset();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: mockFetch as unknown as typeof fetch,
    });
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL = 'http://nagg.test/';
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  afterAll(() => {
    if (originalFetchDescriptor) {
      Object.defineProperty(globalThis, 'fetch', originalFetchDescriptor);
      return;
    }
    Reflect.deleteProperty(globalThis, 'fetch');
  });

  it('enrich fetches quoted events and profiles from the REST endpoints', async () => {
    mockFetch
      .mockResolvedValueOnce(
        restResponse({
          order: [Q1],
          orderBy: 'created_at',
          events: [note({ id: Q1 })],
          aggregates: {},
        })
      )
      .mockResolvedValueOnce(
        restResponse({
          order: [],
          orderBy: 'created_at',
          events: [profileEvent(DAVE, 'Dave')],
          aggregates: {},
        })
      );

    const updates = await loadClient().enrich({
      missingQuotedIds: [Q1],
      missingProfilePubkeys: [DAVE],
    });

    expect(updates.quotedEvents?.get(Q1)).toMatchObject({ id: Q1 });
    expect(updates.profiles?.get(DAVE)).toEqual({ name: 'Dave' });
    const urls = mockFetch.mock.calls.map((call) => String(call[0]));
    expect(urls.some((u) => u.includes('/v1/nostr/events?'))).toBe(true);
    expect(urls.some((u) => u.includes('/v1/nostr/profiles?'))).toBe(true);
  });

  it.each(['following-popular', 'following-recent'])(
    'answers a %s feed opened without an account key with an empty page and no request',
    async (id) => {
      const { getFeedClient } = jest.requireActual<
        typeof import('@/features/feed/data/useFeedClient')
      >('@/features/feed/data/useFeedClient');
      const { emptyFeedParseResult } = jest.requireActual<
        typeof import('@/features/feed/data/feedClient')
      >('@/features/feed/data/feedClient');

      const first = await getFeedClient().getFeed({
        spec: JSON.stringify({ id, kind: 'notes', hours: 24 }),
        userPubkey: undefined,
        limit: 30,
      });
      const more = await getFeedClient().getFeed({
        spec: JSON.stringify({ id, kind: 'notes', hours: 24 }),
        userPubkey: undefined,
        limit: 30,
        loadMore: true,
        seen: [],
      });

      expect(first).toEqual(emptyFeedParseResult());
      expect(more).toEqual(emptyFeedParseResult());
      expect(mockFetch).not.toHaveBeenCalled();
    }
  );
});
