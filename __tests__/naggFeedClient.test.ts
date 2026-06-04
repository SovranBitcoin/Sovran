jest.mock('colada', () => ({
  combineSignals: (...signals: (AbortSignal | undefined)[]) =>
    signals.find((signal): signal is AbortSignal => !!signal) ?? new AbortController().signal,
  createNostrGraphqlMintEnrichment: jest.fn(() => ({
    fetchMintReviews: jest.fn(),
    resolveMintContactProfile: jest.fn(),
  })),
  isAbortError: () => false,
  timeoutSignal: () => new AbortController().signal,
}));

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

const root = {
  id: 'root',
  kind: 1,
  pubkey: 'alice',
  content: 'root',
  tags: [],
  created_at: 100,
};
const rootGql = {
  id: 'root',
  kind: 1,
  pubkey: 'alice',
  content: 'root',
  tags: [],
  createdAt: 100,
  authorMetadata: [
    {
      id: 'profile-alice',
      kind: 0,
      pubkey: 'alice',
      content: JSON.stringify({ name: 'Alice' }),
      tags: [],
      createdAt: 99,
    },
  ],
  likes: { rows: [] },
  reposts: { rows: [] },
  replyStats: { rows: [] },
  zaps: { rows: [] },
};

describe('createNaggFeedClient', () => {
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

  it('posts hydrated feed specs to nagg and maps the response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          events: {
            nodes: [rootGql],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }),
    });

    const { createNaggFeedClient } = jest.requireActual<
      typeof import('@/features/feed/data/naggFeedClient')
    >('@/features/feed/data/naggFeedClient');

    const result = await createNaggFeedClient().getFeed({
      spec: JSON.stringify({ id: 'feed' }),
      userPubkey: 'viewer',
      limit: 12,
    });

    expect(result.orderedFeedItems).toHaveLength(1);
    expect(result.profilesMap.get('alice')).toEqual({ name: 'Alice' });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://nagg.test/graphql',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      })
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.variables.input).toEqual({
      pubkeys: ['viewer'],
      kinds: [1, 6, 16],
      limit: 12,
    });
  });

  it('maps root context for mixed root and reply feed nodes', async () => {
    const replyGql = {
      id: 'reply',
      kind: 1,
      pubkey: 'bob',
      content: 'reply',
      tags: [['e', 'root', '', 'root']],
      createdAt: 101,
      authorMetadata: [
        {
          id: 'profile-bob',
          kind: 0,
          pubkey: 'bob',
          content: JSON.stringify({ name: 'Bob' }),
          tags: [],
          createdAt: 100,
        },
      ],
      rootContext: {
        nodes: [
          {
            ...rootGql,
            likes: { rows: [{ metrics: { pubkeys: 9 } }] },
            reposts: { rows: [{ metrics: { pubkeys: 1 } }] },
            replyStats: { rows: [{ metrics: { events: 2 } }] },
            zaps: { rows: [{ metrics: { amountSats: 3 } }] },
          },
        ],
      },
      eventRefs: { nodes: [] },
      quotedContent: { nodes: [] },
      likes: { rows: [{ metrics: { pubkeys: 4 } }] },
      reposts: { rows: [] },
      replyStats: { rows: [] },
      zaps: { rows: [] },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          events: {
            nodes: [rootGql, replyGql],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }),
    });

    const { createNaggFeedClient } = jest.requireActual<
      typeof import('@/features/feed/data/naggFeedClient')
    >('@/features/feed/data/naggFeedClient');

    const result = await createNaggFeedClient().getFeed({
      spec: JSON.stringify({ id: 'feed' }),
      limit: 2,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.query).toContain('rootContext: selectedReferences');
    expect(body.query).toContain('excludeMarkers: ["mention"]');
    expect(result.orderedFeedItems).toHaveLength(2);
    expect(result.orderedFeedItems[1]).toMatchObject({
      type: 'note',
      event: expect.objectContaining({ id: 'reply' }),
      rootEvent: expect.objectContaining({ id: 'root' }),
      rootEventId: 'root',
    });
    expect(result.metricsMap.get('root')).toEqual({
      likeCount: 9,
      repostCount: 1,
      replyCount: 2,
      satsZapped: 3,
    });
    expect(result.metricsMap.get('reply')?.likeCount).toBe(4);
    expect(result.profilesMap.get('bob')).toEqual({ name: 'Bob' });
  });

  it('sends explicit refresh feed requests as uncached network reads', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1234567890);
    const trendingRootGql = {
      ...rootGql,
      likes: { rows: [{ metrics: { pubkeys: 42 } }] },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          rankedEvents: {
            nodes: [trendingRootGql],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }),
    });

    try {
      const { createNaggFeedClient } = jest.requireActual<
        typeof import('@/features/feed/data/naggFeedClient')
      >('@/features/feed/data/naggFeedClient');

      const result = await createNaggFeedClient().getFeed({
        spec: JSON.stringify({ id: 'global-trending', kind: 'notes' }),
        refresh: true,
      });
      expect(result.metricsMap.get('root')?.likeCount).toBe(42);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://nagg.test/graphql',
        expect.objectContaining({
          method: 'POST',
          cache: 'no-store',
        })
      );

      const init = mockFetch.mock.calls[0][1] as RequestInit;
      const headers = new Headers(init.headers);
      expect(headers.get('Cache-Control')).toBe('no-cache');
      expect(headers.get('Pragma')).toBe('no-cache');
      const body = JSON.parse(init.body as string);
      expect(body.query).toContain('rankedEvents');
      expect(body.variables.input).toEqual({
        references: {
          kinds: [7],
          since: Math.floor(1234567890 / 1000) - 86_400,
        },
        via: { key: 'e' },
        target: { kinds: [1] },
        metric: { name: 'likers', op: 'COUNT_DISTINCT', distinctField: 'PUBKEY' },
        limit: 30,
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('requests and maps a viewer-derived ranked reply for trending feeds', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1234567890);
    const replyGql = {
      id: 'reply',
      kind: 1,
      pubkey: 'bob',
      content: 'reply from a derived pubkey source',
      tags: [['e', 'root']],
      createdAt: 99,
      authorMetadata: [
        {
          id: 'profile-bob',
          kind: 0,
          pubkey: 'bob',
          content: JSON.stringify({ name: 'Bob' }),
          tags: [],
          createdAt: 98,
        },
      ],
      quotedContent: { nodes: [] },
    };
    const trendingRootGql = {
      ...rootGql,
      likes: { rows: [{ metrics: { pubkeys: 42 } }] },
      followedReply: { nodes: [replyGql] },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          rankedEvents: {
            nodes: [trendingRootGql],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }),
    });

    try {
      const { createNaggFeedClient } = jest.requireActual<
        typeof import('@/features/feed/data/naggFeedClient')
      >('@/features/feed/data/naggFeedClient');

      const result = await createNaggFeedClient().getFeed({
        spec: JSON.stringify({ id: 'global-trending', kind: 'notes' }),
        userPubkey: 'viewer',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.query).toContain('rankedReferencedBy');
      expect(body.query).toContain('latestEventTags');
      expect(body.query).toContain('sourceEventAuthor');
      expect(body.variables).toEqual({
        input: {
          references: {
            kinds: [7],
            since: Math.floor(1234567890 / 1000) - 86_400,
          },
          via: { key: 'e' },
          target: { kinds: [1] },
          metric: { name: 'likers', op: 'COUNT_DISTINCT', distinctField: 'PUBKEY' },
          limit: 30,
        },
        viewerPubkey: 'viewer',
      });
      expect(result.orderedFeedItems).toHaveLength(1);
      expect(result.orderedFeedItems[0]).toMatchObject({
        type: 'note',
        event: expect.objectContaining({ id: 'root' }),
        replyPreviewEvents: [expect.objectContaining({ id: 'reply' })],
      });
      expect(result.metricsMap.get('root')?.likeCount).toBe(42);
      expect(result.metricsMap.get('reply')).toEqual({
        likeCount: 0,
        repostCount: 0,
        replyCount: 0,
        satsZapped: 0,
      });
      expect(result.profilesMap.get('bob')).toEqual({ name: 'Bob' });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('falls back to followed reply previews when source author pubkeys are not deployed', async () => {
    const replyGql = {
      id: 'reply',
      kind: 1,
      pubkey: 'bob',
      content: 'legacy followed reply',
      tags: [['e', 'root']],
      createdAt: 99,
      authorMetadata: [],
      quotedContent: { nodes: [] },
      likes: { rows: [] },
      reposts: { rows: [] },
      replyStats: { rows: [] },
      zaps: { rows: [] },
    };
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          errors: [
            { message: 'Field "sourceEventAuthor" is not defined by type PubkeySourceInput' },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          data: {
            rankedEvents: {
              nodes: [{ ...rootGql, followedReply: { nodes: [replyGql] } }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        }),
      });

    const { createNaggFeedClient } = jest.requireActual<
      typeof import('@/features/feed/data/naggFeedClient')
    >('@/features/feed/data/naggFeedClient');

    const result = await createNaggFeedClient().getFeed({
      spec: JSON.stringify({ id: 'global-trending', kind: 'notes' }),
      userPubkey: 'viewer',
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(firstBody.query).toContain('sourceEventAuthor');
    expect(secondBody.query).not.toContain('sourceEventAuthor');
    expect(result.orderedFeedItems[0]).toMatchObject({
      type: 'note',
      event: expect.objectContaining({ id: 'root' }),
      replyPreviewEvents: [expect.objectContaining({ id: 'reply' })],
    });
  });

  it('maps only the selected author thread chain plus a followed tail preview', async () => {
    const secondAuthorReply: any = {
      id: 'author-second',
      kind: 1,
      pubkey: 'alice',
      content: 'second self reply',
      tags: [
        ['e', 'root', '', 'root'],
        ['e', 'author-direct', '', 'reply'],
      ],
      createdAt: 102,
      authorMetadata: [],
    };
    const directAuthorReply = {
      id: 'author-direct',
      kind: 1,
      pubkey: 'alice',
      content: 'first self reply',
      tags: [['e', 'root', '', 'reply']],
      createdAt: 101,
      authorMetadata: [],
      childAuthorReplies: { nodes: [secondAuthorReply] },
    };
    const authorReplyToSomeoneElse = {
      id: 'author-branch',
      kind: 1,
      pubkey: 'alice',
      content: 'author reply on another branch',
      tags: [
        ['e', 'root', '', 'root'],
        ['e', 'bob-reply', '', 'reply'],
      ],
      createdAt: 103,
      authorMetadata: [],
    };
    const followedTail = {
      id: 'followed-tail',
      kind: 1,
      pubkey: 'carol',
      content: 'followed tail reply',
      tags: [
        ['e', 'root', '', 'root'],
        ['e', 'author-second', '', 'reply'],
      ],
      createdAt: 104,
      authorMetadata: [],
    };
    secondAuthorReply.childFollowedReply = { nodes: [followedTail] };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          rankedEvents: {
            nodes: [
              {
                ...rootGql,
                authorReplies: {
                  nodes: [authorReplyToSomeoneElse, directAuthorReply],
                },
                followedReply: { nodes: [] },
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }),
    });

    const { createNaggFeedClient } = jest.requireActual<
      typeof import('@/features/feed/data/naggFeedClient')
    >('@/features/feed/data/naggFeedClient');

    const result = await createNaggFeedClient().getFeed({
      spec: JSON.stringify({ id: 'global-trending', kind: 'notes' }),
      userPubkey: 'viewer',
    });

    expect(result.orderedFeedItems[0]).toMatchObject({
      type: 'note',
      event: expect.objectContaining({ id: 'root' }),
    });
    expect(
      result.orderedFeedItems[0].type === 'note'
        ? result.orderedFeedItems[0].replyPreviewEvents?.map((event) => event.id)
        : []
    ).toEqual(['author-direct', 'author-second', 'followed-tail']);
  });

  it('requests only followed replies and maps their parent context', async () => {
    const replyGql = {
      id: 'reply',
      kind: 1,
      pubkey: 'bob',
      content: 'reply from someone followed',
      tags: [['e', 'root', '', 'reply']],
      createdAt: 99,
      authorMetadata: [
        {
          id: 'profile-bob',
          kind: 0,
          pubkey: 'bob',
          content: JSON.stringify({ name: 'Bob' }),
          tags: [],
          createdAt: 98,
        },
      ],
      rootContext: {
        nodes: [
          {
            ...rootGql,
            likes: { rows: [{ metrics: { pubkeys: 11 } }] },
            reposts: { rows: [{ metrics: { pubkeys: 1 } }] },
            replyStats: { rows: [{ metrics: { events: 4 } }] },
            zaps: { rows: [{ metrics: { amountSats: 8 } }] },
          },
        ],
      },
      eventRefs: { nodes: [rootGql] },
      quotedContent: { nodes: [] },
      likes: { rows: [{ metrics: { pubkeys: 5 } }] },
      reposts: { rows: [{ metrics: { pubkeys: 2 } }] },
      replyStats: { rows: [{ metrics: { events: 3 } }] },
      zaps: { rows: [{ metrics: { amountSats: 4 } }] },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          events: {
            nodes: [replyGql],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }),
    });

    const { createNaggFeedClient } = jest.requireActual<
      typeof import('@/features/feed/data/naggFeedClient')
    >('@/features/feed/data/naggFeedClient');

    const result = await createNaggFeedClient().getFeed({
      spec: JSON.stringify({ id: 'following-replies', kind: 'notes' }),
      userPubkey: 'viewer',
      limit: 12,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.query).toContain('query NaggGraphqlFollowingReplies');
    expect(body.query).toContain('rootContext: selectedReferences');
    expect(body.query).not.toContain('parentRootRefs');
    expect(body.query).not.toContain('parentReplyRefs');
    expect(body.variables.input).toEqual({
      kinds: [1, 1111],
      tags: [{ key: 'e' }],
      pubkeysFrom: [
        {
          latestEventTags: {
            pubkey: 'viewer',
            kinds: [3],
            tag: { key: 'p' },
            limit: 1,
            maxValues: 2000,
          },
        },
      ],
      limit: 12,
    });
    expect(result.orderedFeedItems).toHaveLength(1);
    expect(result.orderedFeedItems[0]).toMatchObject({
      type: 'note',
      event: expect.objectContaining({ id: 'reply' }),
      rootEvent: expect.objectContaining({ id: 'root' }),
      rootEventId: 'root',
    });
    expect(result.metricsMap.get('reply')).toEqual({
      likeCount: 5,
      repostCount: 2,
      replyCount: 3,
      satsZapped: 4,
    });
    expect(result.metricsMap.get('root')).toEqual({
      likeCount: 11,
      repostCount: 1,
      replyCount: 4,
      satsZapped: 8,
    });
    expect(result.profilesMap.get('bob')).toEqual({ name: 'Bob' });
    expect(result.profilesMap.get('alice')).toEqual({ name: 'Alice' });
  });

  it('requests popular followed posts and replies through rankedEvents', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1234567890);
    const replyGql = {
      id: 'reply',
      kind: 1,
      pubkey: 'bob',
      content: 'popular reply from someone followed',
      tags: [['e', 'root', '', 'reply']],
      createdAt: 99,
      authorMetadata: [
        {
          id: 'profile-bob',
          kind: 0,
          pubkey: 'bob',
          content: JSON.stringify({ name: 'Bob' }),
          tags: [],
          createdAt: 98,
        },
      ],
      rootContext: {
        nodes: [
          {
            ...rootGql,
            likes: { rows: [{ metrics: { pubkeys: 11 } }] },
            reposts: { rows: [{ metrics: { pubkeys: 1 } }] },
            replyStats: { rows: [{ metrics: { events: 4 } }] },
            zaps: { rows: [{ metrics: { amountSats: 8 } }] },
          },
        ],
      },
      eventRefs: { nodes: [rootGql] },
      quotedContent: { nodes: [] },
      likes: { rows: [{ metrics: { pubkeys: 5 } }] },
      reposts: { rows: [{ metrics: { pubkeys: 2 } }] },
      replyStats: { rows: [{ metrics: { events: 3 } }] },
      zaps: { rows: [{ metrics: { amountSats: 4 } }] },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          rankedEvents: {
            nodes: [replyGql],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }),
    });

    try {
      const { createNaggFeedClient } = jest.requireActual<
        typeof import('@/features/feed/data/naggFeedClient')
      >('@/features/feed/data/naggFeedClient');

      const result = await createNaggFeedClient().getFeed({
        spec: JSON.stringify({ id: 'following-popular', kind: 'notes', hours: 24 }),
        userPubkey: 'viewer',
        limit: 12,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.query).toContain('query NaggGraphqlFollowingPopular');
      expect(body.query).toContain('rankedEvents');
      expect(body.variables.input).toEqual({
        references: {
          kinds: [7],
          since: Math.floor(1234567890 / 1000) - 86_400,
        },
        via: { key: 'e' },
        target: {
          kinds: [1, 1111],
          pubkeysFrom: [
            {
              latestEventTags: {
                pubkey: 'viewer',
                kinds: [3],
                tag: { key: 'p' },
                limit: 1,
                maxValues: 2000,
              },
            },
          ],
        },
        metric: { name: 'likers', op: 'COUNT_DISTINCT', distinctField: 'PUBKEY' },
        limit: 12,
      });
      expect(result.orderedFeedItems).toHaveLength(1);
      expect(result.orderedFeedItems[0]).toMatchObject({
        type: 'note',
        event: expect.objectContaining({ id: 'reply' }),
        rootEvent: expect.objectContaining({ id: 'root' }),
        rootEventId: 'root',
      });
      expect(result.metricsMap.get('reply')).toEqual({
        likeCount: 5,
        repostCount: 2,
        replyCount: 3,
        satsZapped: 4,
      });
      expect(result.metricsMap.get('root')).toEqual({
        likeCount: 11,
        repostCount: 1,
        replyCount: 4,
        satsZapped: 8,
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('maps followed reply previews for popular following root posts', async () => {
    const replyGql = {
      id: 'reply',
      kind: 1,
      pubkey: 'bob',
      content: 'popular followed reply',
      tags: [['e', 'root', '', 'reply']],
      createdAt: 101,
      authorMetadata: [],
      quotedContent: { nodes: [] },
      likes: { rows: [] },
      reposts: { rows: [] },
      replyStats: { rows: [] },
      zaps: { rows: [] },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          rankedEvents: {
            nodes: [{ ...rootGql, followedReply: { nodes: [replyGql] } }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }),
    });

    const { createNaggFeedClient } = jest.requireActual<
      typeof import('@/features/feed/data/naggFeedClient')
    >('@/features/feed/data/naggFeedClient');

    const result = await createNaggFeedClient().getFeed({
      spec: JSON.stringify({ id: 'following-popular', kind: 'notes', hours: 24 }),
      userPubkey: 'viewer',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.query).toContain('followedReply');
    expect(body.query).toContain('sourceEventAuthor');
    expect(result.orderedFeedItems).toHaveLength(1);
    expect(result.orderedFeedItems[0]).toMatchObject({
      type: 'note',
      event: expect.objectContaining({ id: 'root' }),
      replyPreviewEvents: [expect.objectContaining({ id: 'reply' })],
    });
  });

  it('falls back to a lightweight trending query after a GraphQL deadline', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          errors: [{ message: 'context deadline exceeded' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          data: {
            rankedEvents: {
              nodes: [rootGql],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        }),
      });

    const { createNaggFeedClient } = jest.requireActual<
      typeof import('@/features/feed/data/naggFeedClient')
    >('@/features/feed/data/naggFeedClient');

    const result = await createNaggFeedClient().getFeed({
      spec: JSON.stringify({ id: 'global-trending', kind: 'notes' }),
      userPubkey: 'viewer',
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(firstBody.query).toContain('sourceEventAuthor');
    expect(secondBody.query).not.toContain('sourceEventAuthor');
    expect(secondBody.query).not.toContain('followedReply');
    expect(secondBody.variables).toEqual({ input: firstBody.variables.input });
    expect(result.orderedFeedItems).toHaveLength(1);
    expect(result.orderedFeedItems[0]).toMatchObject({
      type: 'note',
      event: expect.objectContaining({ id: 'root' }),
    });
  });

  it('falls back to a lightweight popular following query after a GraphQL deadline', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          errors: [{ message: 'context deadline exceeded' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          data: {
            rankedEvents: {
              nodes: [rootGql],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        }),
      });

    const { createNaggFeedClient } = jest.requireActual<
      typeof import('@/features/feed/data/naggFeedClient')
    >('@/features/feed/data/naggFeedClient');

    const result = await createNaggFeedClient().getFeed({
      spec: JSON.stringify({ id: 'following-popular', kind: 'notes', hours: 24 }),
      userPubkey: 'viewer',
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(firstBody.query).toContain('sourceEventAuthor');
    expect(secondBody.query).not.toContain('sourceEventAuthor');
    expect(secondBody.query).not.toContain('followedReply');
    expect(secondBody.variables).toEqual({ input: firstBody.variables.input });
    expect(result.orderedFeedItems).toHaveLength(1);
    expect(result.orderedFeedItems[0]).toMatchObject({
      type: 'note',
      event: expect.objectContaining({ id: 'root' }),
    });
  });

  it('requests recent followed posts and replies through derived pubkeys', async () => {
    const replyGql = {
      id: 'reply',
      kind: 1,
      pubkey: 'bob',
      content: 'recent reply from someone followed',
      tags: [['e', 'root', '', 'reply']],
      createdAt: 99,
      authorMetadata: [
        {
          id: 'profile-bob',
          kind: 0,
          pubkey: 'bob',
          content: JSON.stringify({ name: 'Bob' }),
          tags: [],
          createdAt: 98,
        },
      ],
      rootContext: {
        nodes: [
          {
            ...rootGql,
            likes: { rows: [{ metrics: { pubkeys: 11 } }] },
            reposts: { rows: [{ metrics: { pubkeys: 1 } }] },
            replyStats: { rows: [{ metrics: { events: 4 } }] },
            zaps: { rows: [{ metrics: { amountSats: 8 } }] },
          },
        ],
      },
      eventRefs: { nodes: [rootGql] },
      quotedContent: { nodes: [] },
      likes: { rows: [{ metrics: { pubkeys: 5 } }] },
      reposts: { rows: [{ metrics: { pubkeys: 2 } }] },
      replyStats: { rows: [{ metrics: { events: 3 } }] },
      zaps: { rows: [{ metrics: { amountSats: 4 } }] },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          events: {
            nodes: [replyGql],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }),
    });

    const { createNaggFeedClient } = jest.requireActual<
      typeof import('@/features/feed/data/naggFeedClient')
    >('@/features/feed/data/naggFeedClient');

    const result = await createNaggFeedClient().getFeed({
      spec: JSON.stringify({ id: 'following-recent', kind: 'notes' }),
      userPubkey: 'viewer',
      limit: 12,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.query).toContain('query NaggGraphqlFeed');
    expect(body.variables.input).toEqual({
      kinds: [1, 1111],
      pubkeysFrom: [
        {
          latestEventTags: {
            pubkey: 'viewer',
            kinds: [3],
            tag: { key: 'p' },
            limit: 1,
            maxValues: 2000,
          },
        },
      ],
      limit: 12,
    });
    expect(result.orderedFeedItems).toHaveLength(1);
    expect(result.orderedFeedItems[0]).toMatchObject({
      type: 'note',
      event: expect.objectContaining({ id: 'reply' }),
      rootEvent: expect.objectContaining({ id: 'root' }),
      rootEventId: 'root',
    });
    expect(result.profilesMap.get('bob')).toEqual({ name: 'Bob' });
    expect(result.profilesMap.get('alice')).toEqual({ name: 'Alice' });
  });

  it('does not request followed replies without a viewer pubkey', async () => {
    const { createNaggFeedClient } = jest.requireActual<
      typeof import('@/features/feed/data/naggFeedClient')
    >('@/features/feed/data/naggFeedClient');

    const result = await createNaggFeedClient().getFeed({
      spec: JSON.stringify({ id: 'following-replies', kind: 'notes' }),
      limit: 12,
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.orderedFeedItems).toEqual([]);
  });

  it('keeps user feeds filtered to root notes and reposts', async () => {
    const reply = {
      id: 'reply',
      kind: 1,
      pubkey: 'alice',
      content: 'reply',
      tags: [['e', 'root', '', 'reply']],
      createdAt: 99,
      authorMetadata: [],
      likes: { rows: [] },
      reposts: { rows: [] },
      replyStats: { rows: [] },
      zaps: { rows: [] },
    };
    const repost = {
      id: 'repost',
      kind: 6,
      pubkey: 'alice',
      content: '',
      tags: [['e', root.id]],
      createdAt: 98,
      authorMetadata: [],
      eventRefs: { nodes: [rootGql] },
      likes: { rows: [] },
      reposts: { rows: [] },
      replyStats: { rows: [] },
      zaps: { rows: [] },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          events: {
            nodes: [rootGql, reply, repost],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }),
    });

    const { createNaggFeedClient } = jest.requireActual<
      typeof import('@/features/feed/data/naggFeedClient')
    >('@/features/feed/data/naggFeedClient');

    const result = await createNaggFeedClient().getUserFeed({
      pubkey: 'alice',
      authorName: 'Alice',
    });

    expect(mockFetch.mock.calls[0][0]).toBe('http://nagg.test/graphql');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).variables.input).toEqual({
      pubkeys: ['alice'],
      kinds: [1, 6, 16],
      limit: 50,
    });
    expect(result.orderedFeedItems.map((item) => item.type)).toEqual(['note', 'repost']);
    expect(
      result.orderedFeedItems.map((item) =>
        item.type === 'note' ? item.event.id : item.repostEvent.id
      )
    ).toEqual(['root', 'repost']);
    expect(result.profilesMap.get('alice')).toEqual({ name: 'Alice' });
  });

  it('maps default ranked thread responses into thread buckets', async () => {
    const reply = {
      id: 'reply',
      kind: 1,
      pubkey: 'bob',
      content: 'reply',
      tags: [['e', 'root', '', 'reply']],
      createdAt: 101,
      authorMetadata: [
        {
          id: 'profile-bob',
          kind: 0,
          pubkey: 'bob',
          content: JSON.stringify({ name: 'Bob' }),
          tags: [],
          createdAt: 100,
        },
      ],
      likes: { rows: [] },
      reposts: { rows: [] },
      replyStats: { rows: [] },
      zaps: { rows: [] },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          event: {
            ...rootGql,
            replyStats: { rows: [{ metrics: { events: 1 } }] },
            replies: { nodes: [reply] },
            parentRefs: { nodes: [] },
            quotedContent: { nodes: [] },
          },
        },
      }),
    });

    const { createNaggFeedClient } = jest.requireActual<
      typeof import('@/features/feed/data/naggFeedClient')
    >('@/features/feed/data/naggFeedClient');

    const result = await createNaggFeedClient().getThread({ eventId: 'root' });

    expect(mockFetch.mock.calls[0][0]).toBe('http://nagg.test/graphql');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.variables.id).toBe('root');
    expect(body.variables.candidateLimit).toBe(100);
    expect(body.variables.rankedLimit).toBe(50);
    expect(body.variables.viewerPubkey).toBe('');
    expect(body.variables.rank).toMatchObject({
      references: { kinds: [7], limit: 500 },
      via: { key: 'e' },
      metric: { name: 'likes', op: 'COUNT_DISTINCT', distinctField: 'PUBKEY' },
      weight: 3,
      transform: 'LOG1P',
      terms: [
        {
          references: { kinds: [1, 1111], limit: 500 },
          via: { key: 'e' },
          metric: { name: 'replies', op: 'COUNT_DISTINCT', distinctField: 'ID' },
          weight: 2.5,
          transform: 'LOG1P',
        },
        {
          references: { kinds: [6, 16], limit: 500 },
          via: { key: 'e' },
          metric: { name: 'reposts', op: 'COUNT_DISTINCT', distinctField: 'PUBKEY' },
          weight: 2,
          transform: 'LOG1P',
        },
        {
          references: { kinds: [9735], limit: 500 },
          via: { key: 'e' },
          metric: { name: 'zapSats', op: 'SUM', derived: 'nip57.amount_sats' },
          weight: 1.5,
          transform: 'LOG1P',
        },
      ],
    });
    expect(body.query).toContain('rankedReferencedBy');
    expect(body.query).toContain('rank: $rank');
    expect(body.query).toContain('allReplies: referencedBy');
    expect(body.query).toContain('sourceEventAuthor');
    expect(body.query).toContain('followedReply');
    expect(body.query).not.toContain('offset: $offset');
    expect(body.query).not.toContain('childReplies');
    expect(result.thread.target?.id).toBe('root');
    expect(result.thread.replies.map((event) => event.id)).toEqual(['reply']);
    expect(result.replyPageEventIds).toEqual(['reply']);
    expect(result.metrics.get('root')?.replyCount).toBe(1);
    expect(result.profiles.get('bob')).toEqual({ name: 'Bob' });
    expect(result.replyPageSize).toBe(10);
    expect(result.loadedReplyCount).toBe(1);
    expect(result.hasMoreReplies).toBe(false);
  });

  it('orders relevant thread replies as the author thread chain, followed tail, then ranked remainder', async () => {
    const authorSecond: any = {
      id: 'author-second',
      kind: 1,
      pubkey: 'alice',
      content: 'author second self reply',
      tags: [
        ['e', 'root', '', 'root'],
        ['e', 'author-direct', '', 'reply'],
      ],
      createdAt: 103,
      likes: { rows: [] },
      reposts: { rows: [] },
      replyStats: { rows: [] },
      zaps: { rows: [] },
    };
    const authorDirect = {
      id: 'author-direct',
      kind: 1,
      pubkey: 'alice',
      content: 'author direct self reply',
      tags: [['e', 'root', '', 'reply']],
      createdAt: 102,
      likes: { rows: [] },
      reposts: { rows: [] },
      replyStats: { rows: [] },
      zaps: { rows: [] },
      childAuthorReplies: { nodes: [authorSecond] },
    };
    const authorBranch = {
      id: 'author-branch',
      kind: 1,
      pubkey: 'alice',
      content: 'author reply on someone else branch',
      tags: [
        ['e', 'root', '', 'root'],
        ['e', 'bob-reply', '', 'reply'],
      ],
      createdAt: 101,
      likes: { rows: [] },
      reposts: { rows: [] },
      replyStats: { rows: [] },
      zaps: { rows: [] },
    };
    const followed = {
      id: 'followed',
      kind: 1,
      pubkey: 'bob',
      content: 'followed reply',
      tags: [
        ['e', 'root', '', 'root'],
        ['e', 'author-second', '', 'reply'],
      ],
      createdAt: 104,
      likes: { rows: [] },
      reposts: { rows: [] },
      replyStats: { rows: [] },
      zaps: { rows: [] },
    };
    authorSecond.childFollowedReply = { nodes: [followed] };
    const ranked = {
      id: 'ranked',
      kind: 1,
      pubkey: 'carol',
      content: 'ranked reply',
      tags: [['e', 'root', '', 'reply']],
      createdAt: 104,
      likes: { rows: [] },
      reposts: { rows: [] },
      replyStats: { rows: [] },
      zaps: { rows: [] },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          event: {
            ...rootGql,
            replyStats: { rows: [{ metrics: { events: 4 } }] },
            authorReplies: { nodes: [authorBranch, authorDirect] },
            followedReply: { nodes: [] },
            replies: { nodes: [followed, ranked, authorBranch] },
            parentRefs: { nodes: [] },
            quotedContent: { nodes: [] },
          },
        },
      }),
    });

    const { createNaggFeedClient } = jest.requireActual<
      typeof import('@/features/feed/data/naggFeedClient')
    >('@/features/feed/data/naggFeedClient');

    const result = await createNaggFeedClient().getThread({
      eventId: 'root',
      viewerPubkey: 'viewer',
      limit: 3,
    });

    expect(result.replyPageEventIds).toEqual(['author-direct', 'author-second', 'followed']);
    expect(result.loadedReplyCount).toBe(3);
    expect(result.hasMoreReplies).toBe(true);
    expect(result.thread.replies.map((event) => event.id).sort()).toEqual(
      ['author-direct', 'author-second', 'followed', 'ranked'].sort()
    );
  });

  it('fills relevant thread pages from plain replies when ranked replies under-return', async () => {
    const rankedTop = {
      id: 'ranked-top',
      kind: 1,
      pubkey: 'bob',
      content: 'ranked reply',
      tags: [['e', 'root', '', 'reply']],
      createdAt: 104,
      likes: { rows: [{ metrics: { pubkeys: 4 } }] },
      reposts: { rows: [] },
      replyStats: { rows: [] },
      zaps: { rows: [] },
    };
    const plainA = {
      id: 'plain-a',
      kind: 1,
      pubkey: 'carol',
      content: 'plain reply a',
      tags: [['e', 'root', '', 'reply']],
      createdAt: 103,
      likes: { rows: [] },
      reposts: { rows: [] },
      replyStats: { rows: [] },
      zaps: { rows: [] },
    };
    const plainB = {
      id: 'plain-b',
      kind: 1,
      pubkey: 'dave',
      content: 'plain reply b',
      tags: [['e', 'root', '', 'reply']],
      createdAt: 102,
      likes: { rows: [] },
      reposts: { rows: [] },
      replyStats: { rows: [] },
      zaps: { rows: [] },
    };
    const plainC = {
      id: 'plain-c',
      kind: 1,
      pubkey: 'erin',
      content: 'plain reply c',
      tags: [['e', 'root', '', 'reply']],
      createdAt: 101,
      likes: { rows: [] },
      reposts: { rows: [] },
      replyStats: { rows: [] },
      zaps: { rows: [] },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          event: {
            ...rootGql,
            replyStats: { rows: [{ metrics: { events: 4 } }] },
            authorReplies: { nodes: [] },
            followedReply: { nodes: [] },
            replies: { nodes: [rankedTop] },
            allReplies: { nodes: [rankedTop, plainA, plainB, plainC] },
            parentRefs: { nodes: [] },
            quotedContent: { nodes: [] },
          },
        },
      }),
    });

    const { createNaggFeedClient } = jest.requireActual<
      typeof import('@/features/feed/data/naggFeedClient')
    >('@/features/feed/data/naggFeedClient');

    const result = await createNaggFeedClient().getThread({
      eventId: 'root',
      viewerPubkey: 'viewer',
      limit: 3,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.variables.rankedLimit).toBe(50);
    expect(body.query).toContain('allReplies: referencedBy');
    expect(result.replyPageEventIds).toEqual(['ranked-top', 'plain-a', 'plain-b']);
    expect(result.loadedReplyCount).toBe(3);
    expect(result.hasMoreReplies).toBe(true);
    expect(result.thread.replies.map((event) => event.id).sort()).toEqual(
      ['ranked-top', 'plain-a', 'plain-b', 'plain-c'].sort()
    );
  });

  it('falls back to ranked thread replies when source author pubkeys are not deployed', async () => {
    const reply = {
      id: 'reply',
      kind: 1,
      pubkey: 'bob',
      content: 'legacy ranked reply',
      tags: [['e', 'root', '', 'reply']],
      createdAt: 101,
      authorMetadata: [],
      likes: { rows: [] },
      reposts: { rows: [] },
      replyStats: { rows: [] },
      zaps: { rows: [] },
    };
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          errors: [
            { message: 'Field "sourceEventAuthor" is not defined by type PubkeySourceInput' },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          data: {
            event: {
              ...rootGql,
              replies: { nodes: [reply] },
              parentRefs: { nodes: [] },
              quotedContent: { nodes: [] },
            },
          },
        }),
      });

    const { createNaggFeedClient } = jest.requireActual<
      typeof import('@/features/feed/data/naggFeedClient')
    >('@/features/feed/data/naggFeedClient');

    const result = await createNaggFeedClient().getThread({
      eventId: 'root',
      viewerPubkey: 'viewer',
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(firstBody.query).toContain('sourceEventAuthor');
    expect(secondBody.query).not.toContain('sourceEventAuthor');
    expect(secondBody.query).toContain('offset: $offset');
    expect(result.replyPageEventIds).toEqual(['reply']);
    expect(result.thread.replies.map((event) => event.id)).toEqual(['reply']);
  });

  it('adds followed pubkey boosts to relevant thread reply ranking', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          event: {
            ...rootGql,
            replies: { nodes: [] },
            parentRefs: { nodes: [] },
            quotedContent: { nodes: [] },
          },
        },
      }),
    });

    const { createNaggFeedClient } = jest.requireActual<
      typeof import('@/features/feed/data/naggFeedClient')
    >('@/features/feed/data/naggFeedClient');

    await createNaggFeedClient().getThread({
      eventId: 'root',
      viewerPubkey: 'viewer',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.variables.rank.candidatePubkeyBoosts).toEqual([
      {
        pubkeysFrom: [
          {
            latestEventTags: {
              pubkey: 'viewer',
              kinds: [3],
              tag: { key: 'p' },
              limit: 1,
              maxValues: 2000,
            },
          },
        ],
        weight: 6,
      },
    ]);
  });

  it('requests new thread reply pages with offset and reports more pages', async () => {
    const replies = Array.from({ length: 10 }, (_, index) => ({
      id: `reply-${index}`,
      kind: 1,
      pubkey: 'bob',
      content: `reply ${index}`,
      tags: [['e', 'root', '', 'reply']],
      createdAt: 200 - index,
      authorMetadata: [
        {
          id: `profile-bob-${index}`,
          kind: 0,
          pubkey: 'bob',
          content: JSON.stringify({ name: 'Bob' }),
          tags: [],
          createdAt: 100,
        },
      ],
      likes: { rows: [] },
      reposts: { rows: [] },
      replyStats: { rows: [] },
      zaps: { rows: [] },
    }));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          event: {
            ...rootGql,
            replyStats: { rows: [{ metrics: { events: 25 } }] },
            replies: { nodes: replies },
            parentRefs: { nodes: [] },
            quotedContent: { nodes: [] },
          },
        },
      }),
    });

    const { createNaggFeedClient } = jest.requireActual<
      typeof import('@/features/feed/data/naggFeedClient')
    >('@/features/feed/data/naggFeedClient');

    const result = await createNaggFeedClient().getThread({
      eventId: 'root',
      limit: 10,
      offset: 10,
      sort: 'new',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.variables).toEqual({
      id: 'root',
      limit: 10,
      offset: 10,
    });
    expect(body.query).toContain('referencedBy');
    expect(body.query).not.toContain('rankedReferencedBy');
    expect(body.query).toContain('offset: $offset');
    expect(body.query).not.toContain('childReplies');
    expect(result.thread.target?.id).toBe('root');
    expect(result.replyPageEventIds).toEqual(replies.map((reply) => reply.id));
    expect(result.loadedReplyCount).toBe(10);
    expect(result.replyPageSize).toBe(10);
    expect(result.hasMoreReplies).toBe(true);
  });

  it('builds metric-specific thread reply sort rank inputs', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          event: {
            ...rootGql,
            replies: { nodes: [] },
            parentRefs: { nodes: [] },
            quotedContent: { nodes: [] },
          },
        },
      }),
    });

    const { createNaggFeedClient } = jest.requireActual<
      typeof import('@/features/feed/data/naggFeedClient')
    >('@/features/feed/data/naggFeedClient');
    const client = createNaggFeedClient();

    await client.getThread({ eventId: 'root', sort: 'likes' });
    await client.getThread({ eventId: 'root', sort: 'zaps' });
    await client.getThread({ eventId: 'root', sort: 'reposts' });

    const [likesCall, zapsCall, repostsCall] = mockFetch.mock.calls.map((call) =>
      JSON.parse(call[1].body)
    );
    expect(likesCall.variables.rank).toMatchObject({
      references: { kinds: [7], limit: 500 },
      metric: { name: 'likes', op: 'COUNT_DISTINCT', distinctField: 'PUBKEY' },
    });
    expect(zapsCall.variables.rank).toMatchObject({
      references: { kinds: [9735], limit: 500 },
      metric: { name: 'zapSats', op: 'SUM', derived: 'nip57.amount_sats' },
    });
    expect(repostsCall.variables.rank).toMatchObject({
      references: { kinds: [6, 16], limit: 500 },
      metric: { name: 'reposts', op: 'COUNT_DISTINCT', distinctField: 'PUBKEY' },
    });
  });
});
