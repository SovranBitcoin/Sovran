/**
 * Cross-transport equivalence: each view has ONE parse path, so the GraphQL
 * transport (distil `data` with `graphqlToData`, then parse) and the REST
 * app-view transport (parse the already-canonical body) must yield identical
 * parsed output. The flags pick the URL; the result is the same either way.
 */
jest.mock('@sovranbitcoin/colada', () => ({
  combineSignals: (...signals: (AbortSignal | undefined)[]) =>
    signals.find((signal): signal is AbortSignal => !!signal) ?? new AbortController().signal,
  createNostrGraphqlMintEnrichment: jest.fn(() => ({
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

const ENV_KEYS = [
  'EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL',
  'EXPO_PUBLIC_NAGG_BASE_URL',
  'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_SCORE_API_BASE_URL',
  'EXPO_PUBLIC_NOSTR_GRAPHQL_ENDPOINT',
  'EXPO_PUBLIC_NOSTR_FEED_APPVIEW',
  'EXPO_PUBLIC_NOSTR_NOTIFICATIONS_APPVIEW',
] as const;

const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const mockFetch = jest.fn();

const PAD = (value: string) => value.padEnd(64, '0');

const rootGql = {
  id: PAD('root'),
  kind: 1,
  pubkey: PAD('alice'),
  content: 'root',
  tags: [] as string[][],
  createdAt: 100,
  authorMetadata: [
    {
      id: PAD('profile-alice'),
      kind: 0,
      pubkey: PAD('alice'),
      content: JSON.stringify({ name: 'Alice' }),
      tags: [],
      createdAt: 99,
    },
  ],
  rootContext: { nodes: [] },
  eventRefs: { nodes: [] },
  quotedContent: { nodes: [] },
  likes: { rows: [{ metrics: { pubkeys: 5 } }] },
  reposts: { rows: [] },
  replyStats: { rows: [] },
  zaps: { rows: [] },
};

// The canonical NaggFeedPage the GraphQL distiller produces for `rootGql` — the
// REST app-view emits exactly this body, so the REST mock returns it verbatim.
const canonicalFeedPage = {
  items: [
    {
      type: 'note',
      event: {
        id: PAD('root'),
        kind: 1,
        pubkey: PAD('alice'),
        content: 'root',
        tags: [],
        created_at: 100,
      },
    },
  ],
  metrics: {
    [PAD('root')]: { likeCount: 5, repostCount: 0, replyCount: 0, satsZapped: 0 },
  },
  profiles: { [PAD('alice')]: { name: 'Alice' } },
  quoted: {},
  paginationUntil: 100,
  paginationOffset: 1,
};

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  };
}

function setupEnv(extra: Record<string, string> = {}) {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL = 'http://nagg.test/';
  for (const [key, value] of Object.entries(extra)) process.env[key] = value;
}

function loadClient() {
  return jest
    .requireActual<
      typeof import('@/features/feed/data/naggFeedClient')
    >('@/features/feed/data/naggFeedClient')
    .createNaggFeedClient();
}

describe('naggFeedClient transport equivalence', () => {
  beforeEach(() => {
    jest.resetModules();
    mockFetch.mockReset();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: mockFetch as unknown as typeof fetch,
    });
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

  it('getUserFeed yields identical output from GraphQL and app-view transports', async () => {
    // GraphQL: distil the rich node tree.
    setupEnv();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ data: { events: { nodes: [rootGql], pageInfo: { hasNextPage: false } } } })
    );
    const graphqlResult = await loadClient().getUserFeed({ pubkey: PAD('alice') });
    const graphqlUrl = String(mockFetch.mock.calls[0][0]);

    // App-view: parse the canonical REST body directly.
    jest.resetModules();
    mockFetch.mockReset();
    setupEnv({ EXPO_PUBLIC_NOSTR_FEED_APPVIEW: 'true' });
    mockFetch.mockResolvedValueOnce(jsonResponse(canonicalFeedPage));
    const appViewResult = await loadClient().getUserFeed({ pubkey: PAD('alice') });
    const appViewUrl = String(mockFetch.mock.calls[0][0]);

    // Different URLs, identical parsed output.
    expect(graphqlUrl).toContain('/graphql');
    expect(appViewUrl).toContain('/v1/nostr/feed/user');
    expect(appViewResult.orderedFeedItems).toEqual(graphqlResult.orderedFeedItems);
    expect([...appViewResult.metricsMap]).toEqual([...graphqlResult.metricsMap]);
    expect([...appViewResult.profilesMap]).toEqual([...graphqlResult.profilesMap]);
    expect(appViewResult.paginationUntil).toBe(graphqlResult.paginationUntil);
    expect(appViewResult.paginationOffset).toBe(graphqlResult.paginationOffset);
  });

  // Thread intentionally has NO dual-transport equivalence case: it is the
  // documented exception to "prefer app-view" and stays GraphQL-only, because
  // nagg's REST `/nostr/thread` cannot reproduce the viewer-specific relevance
  // ranking (authoredReplyChain + rankedReferencedBy over the follow graph).

  it('getNotifications yields identical output from GraphQL and app-view transports', async () => {
    const notificationNodes = [{ reason: 'mention', actorVertexScore: 7, event: rootGql }];

    setupEnv();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: { notifications: { nodes: notificationNodes, pageInfo: { hasNextPage: false } } },
      })
    );
    const graphqlNotifs = await loadClient().getNotifications({ viewerPubkey: PAD('viewer') });
    const graphqlUrl = String(mockFetch.mock.calls[0][0]);

    // Canonical notifications body the REST `/nostr/notifications` route emits.
    const canonicalNotifications = {
      notifications: {
        nodes: [
          {
            event: {
              id: PAD('root'),
              kind: 1,
              pubkey: PAD('alice'),
              content: 'root',
              tags: [],
              created_at: 100,
            },
            reason: 'mention',
            actorVertexScore: 7,
          },
        ],
        pageInfo: { hasNextPage: false },
      },
      metrics: {
        [PAD('root')]: { likeCount: 5, repostCount: 0, replyCount: 0, satsZapped: 0 },
      },
      profiles: { [PAD('alice')]: { name: 'Alice' } },
      quoted: {},
    };

    jest.resetModules();
    mockFetch.mockReset();
    setupEnv({ EXPO_PUBLIC_NOSTR_NOTIFICATIONS_APPVIEW: 'true' });
    mockFetch.mockResolvedValueOnce(jsonResponse(canonicalNotifications));
    const appViewNotifs = await loadClient().getNotifications({ viewerPubkey: PAD('viewer') });
    const appViewUrl = String(mockFetch.mock.calls[0][0]);

    expect(graphqlUrl).toContain('/graphql');
    expect(appViewUrl).toContain('/v1/nostr/notifications');
    expect(appViewNotifs.notifications).toEqual(graphqlNotifs.notifications);
    expect([...appViewNotifs.metricsMap]).toEqual([...graphqlNotifs.metricsMap]);
    expect([...appViewNotifs.profilesMap]).toEqual([...graphqlNotifs.profilesMap]);
    expect(appViewNotifs.paginationUntil).toBe(graphqlNotifs.paginationUntil);
  });
});
