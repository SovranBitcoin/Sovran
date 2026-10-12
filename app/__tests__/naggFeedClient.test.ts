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
// v2 generic envelopes nagg emits (`{ order, orderBy, events, aggregates,
// cursor? }`, plus `entries`/`hasNext` on notifications), and assert the client
// reconstructs them and hits the right `/v1/nostr/*` route. There is no GraphQL
// transport.

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
const OWN = '2'.repeat(64);
const OTHER = '3'.repeat(64);
const N1 = '4'.repeat(64);
const Q1 = '5'.repeat(64);
const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const CAROL = 'c'.repeat(64);
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

function lastUrl(call = 0): string {
  return String(mockFetch.mock.calls[call][0]);
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

  it('maps a generic feed page from GET /v1/nostr/feed', async () => {
    mockFetch.mockResolvedValueOnce(
      restResponse({
        order: [ROOT],
        orderBy: 'created_at',
        events: [note(), profileEvent(ALICE, 'Alice')],
        aggregates: {},
        cursor: '100|1',
      })
    );

    const result = await loadClient().getFeed({
      spec: JSON.stringify({ id: 'feed' }),
      userPubkey: 'viewer',
      limit: 12,
    });

    expect(result.orderedFeedItems).toHaveLength(1);
    expect(result.profilesMap.get(ALICE)).toEqual({ name: 'Alice' });
    const url = lastUrl();
    expect(url).toContain('/v1/nostr/feed');
    expect(url).toContain('limit=12');
    expect(mockFetch.mock.calls[0][1].method).toBe('GET');
  });

  it('routes a for-you spec to POST /v1/nostr/feed/ranked', async () => {
    mockFetch.mockResolvedValueOnce(
      restResponse({
        order: [ROOT],
        orderBy: 'rank',
        events: [note()],
        aggregates: {},
        cursor: '0|1',
      })
    );

    const result = await loadClient().getFeed({
      spec: JSON.stringify({ id: 'for-you', kind: 'notes' }),
      userPubkey: 'viewer',
      limit: 20,
    });

    expect(result.orderedFeedItems).toHaveLength(1);
    expect(lastUrl()).toContain('/v1/nostr/feed/ranked');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });

  it('getUserFeed filters to the author root notes from /v1/nostr/feed/user', async () => {
    mockFetch.mockResolvedValueOnce(
      restResponse({
        order: [OWN, OTHER],
        orderBy: 'created_at',
        events: [note({ id: OWN, pubkey: BOB }), note({ id: OTHER, pubkey: ALICE })],
        aggregates: {},
        cursor: '100|2',
      })
    );

    const result = await loadClient().getUserFeed({ pubkey: BOB, limit: 50 });

    expect(lastUrl()).toContain('/v1/nostr/feed/user');
    expect(result.orderedFeedItems).toHaveLength(1);
    expect(result.orderedFeedItems[0]).toMatchObject({ type: 'note' });
  });

  it('getNotifications derives reasons from the v2 entries of /v1/nostr/notifications', async () => {
    // v2 sends NO reason strings — a kind-1 entry whose event has no e/q tags
    // must derive to 'mention' client-side.
    mockFetch.mockResolvedValueOnce(
      restResponse({
        order: [],
        orderBy: 'created_at',
        events: [note({ id: N1, pubkey: CAROL }), profileEvent(CAROL, 'Carol')],
        aggregates: {},
        entries: [{ id: N1, kind: 1, actor: CAROL }],
        hasNext: false,
      })
    );

    const result = await loadClient().getNotifications({ viewerPubkey: 'viewer' });

    expect(lastUrl()).toContain('/v1/nostr/notifications');
    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0].reason).toBe('mention');
    expect(result.profilesMap.get(CAROL)).toEqual({ name: 'Carol' });
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

  it('never issues a GraphQL request', async () => {
    mockFetch.mockResolvedValue(
      restResponse({
        order: [],
        orderBy: 'created_at',
        events: [],
        aggregates: {},
      })
    );

    await loadClient().getFeed({
      spec: JSON.stringify({ id: 'feed' }),
      userPubkey: 'viewer',
      limit: 5,
    });

    for (const call of mockFetch.mock.calls) {
      expect(String(call[0])).not.toContain('/graphql');
    }
  });
});
