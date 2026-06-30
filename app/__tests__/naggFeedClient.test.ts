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
// canonical REST bodies nagg emits, and assert the client maps them and hits the
// right `/v1/nostr/*` route. There is no GraphQL transport.

const ENV_KEYS = [
  'EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL',
  'EXPO_PUBLIC_NAGG_BASE_URL',
  'EXPO_PUBLIC_API_BASE_URL',
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

const note = (overrides: Record<string, unknown> = {}) => ({
  id: 'root',
  kind: 1,
  pubkey: 'alice',
  content: 'hello',
  tags: [] as string[][],
  created_at: 100,
  ...overrides,
});

const emptyStats = { likeCount: 0, repostCount: 0, replyCount: 0, satsZapped: 0 };

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
        items: [{ type: 'note', event: note() }],
        ordering: { orderBy: 'created_at', elements: ['root'] },
        metrics: { root: emptyStats },
        profiles: { alice: { name: 'Alice' } },
        quoted: {},
        paginationUntil: 100,
        paginationOffset: 1,
      })
    );

    const result = await loadClient().getFeed({
      spec: JSON.stringify({ id: 'feed' }),
      userPubkey: 'viewer',
      limit: 12,
    });

    expect(result.orderedFeedItems).toHaveLength(1);
    expect(result.profilesMap.get('alice')).toEqual({ name: 'Alice' });
    const url = lastUrl();
    expect(url).toContain('/v1/nostr/feed');
    expect(url).toContain('limit=12');
    expect(mockFetch.mock.calls[0][1].method).toBe('GET');
  });

  it('routes a for-you spec to POST /v1/nostr/feed/ranked', async () => {
    mockFetch.mockResolvedValueOnce(
      restResponse({
        items: [{ type: 'note', event: note() }],
        ordering: { orderBy: 'rank', elements: ['root'] },
        metrics: { root: emptyStats },
        profiles: {},
        quoted: {},
        paginationUntil: 0,
        paginationOffset: 1,
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
        items: [
          { type: 'note', event: note({ id: 'own', pubkey: 'bob' }) },
          { type: 'note', event: note({ id: 'other', pubkey: 'alice' }) },
        ],
        ordering: { orderBy: 'created_at', elements: ['own', 'other'] },
        metrics: {},
        profiles: {},
        quoted: {},
        paginationUntil: 100,
        paginationOffset: 2,
      })
    );

    const result = await loadClient().getUserFeed({ pubkey: 'bob', limit: 50 });

    expect(lastUrl()).toContain('/v1/nostr/feed/user');
    expect(result.orderedFeedItems).toHaveLength(1);
    expect(result.orderedFeedItems[0]).toMatchObject({ type: 'note' });
  });

  it('getNotifications maps the canonical connection from /v1/nostr/notifications', async () => {
    mockFetch.mockResolvedValueOnce(
      restResponse({
        notifications: {
          nodes: [
            {
              event: note({ id: 'n1', pubkey: 'carol' }),
              reason: 'mention',
              actorVertexScore: 0.5,
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
        metrics: { n1: emptyStats },
        profiles: { carol: { name: 'Carol' } },
        quoted: {},
      })
    );

    const result = await loadClient().getNotifications({ viewerPubkey: 'viewer' });

    expect(lastUrl()).toContain('/v1/nostr/notifications');
    expect(result.notifications).toHaveLength(1);
    expect(result.profilesMap.get('carol')).toEqual({ name: 'Carol' });
  });

  it('getThread renders the server reply manifest from /v1/nostr/thread', async () => {
    const reply1 = note({ id: 'reply1', pubkey: 'bob', tags: [['e', 'root', '', 'reply']] });
    const reply2 = note({ id: 'reply2', pubkey: 'carol', tags: [['e', 'root', '', 'reply']] });
    mockFetch.mockResolvedValueOnce(
      restResponse({
        root: note(),
        events: [reply1, reply2],
        ordering: { orderBy: 'rank', elements: ['reply2', 'reply1'] },
        metrics: { root: emptyStats },
        profiles: {},
        quoted: {},
      })
    );

    const result = await loadClient().getThread({
      eventId: 'root',
      sort: 'relevant',
      viewerPubkey: 'viewer',
      limit: 10,
    });

    const url = lastUrl();
    expect(url).toContain('/v1/nostr/thread');
    expect(url).toContain('sort=relevant');
    expect(url).toContain('viewer=viewer');
    expect(result.allEvents.has('root')).toBe(true);
    expect(result.replyPageEventIds).toEqual(['reply2', 'reply1']);
  });

  it('enrich fetches quoted events and profiles from the REST endpoints', async () => {
    mockFetch
      .mockResolvedValueOnce(
        restResponse({
          metrics: { q1: emptyStats },
          profiles: {},
          quoted: { q1: note({ id: 'q1' }) },
        })
      )
      .mockResolvedValueOnce(
        restResponse({ metrics: {}, profiles: { dave: { name: 'Dave' } }, quoted: {} })
      );

    const updates = await loadClient().enrich({
      missingQuotedIds: ['q1'],
      missingProfilePubkeys: ['dave'],
    });

    expect(updates.quotedEvents?.get('q1')).toMatchObject({ id: 'q1' });
    expect(updates.profiles?.get('dave')).toEqual({ name: 'Dave' });
    const urls = mockFetch.mock.calls.map((call) => String(call[0]));
    expect(urls.some((u) => u.includes('/v1/nostr/events?'))).toBe(true);
    expect(urls.some((u) => u.includes('/v1/nostr/profiles?'))).toBe(true);
  });

  it('never issues a GraphQL request', async () => {
    mockFetch.mockResolvedValue(
      restResponse({
        items: [],
        ordering: { orderBy: 'created_at', elements: [] },
        metrics: {},
        profiles: {},
        quoted: {},
        paginationUntil: 0,
        paginationOffset: 0,
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
