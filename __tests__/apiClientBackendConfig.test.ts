const mockFetchMintReviews = jest.fn();
const mockCreateNostrGraphqlMintEnrichment = jest.fn(() => ({
  fetchMintReviews: mockFetchMintReviews,
  resolveMintContactProfile: jest.fn(),
}));

jest.mock('colada', () => ({
  combineSignals: (...signals: (AbortSignal | undefined)[]) =>
    signals.find((signal): signal is AbortSignal => !!signal) ?? new AbortController().signal,
  createNostrGraphqlMintEnrichment: mockCreateNostrGraphqlMintEnrichment,
  isAbortError: () => false,
  timeoutSignal: () => new AbortController().signal,
}));

const PUBKEY = '82341f05fdb1dffbc78894993292171ed03abbed34a95f22f55f9b6371723ee6';
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

describe('apiClient backend config routing', () => {
  beforeEach(() => {
    jest.resetModules();
    mockFetch.mockReset();
    mockCreateNostrGraphqlMintEnrichment.mockClear();
    mockFetchMintReviews.mockReset();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => ({}),
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: mockFetch as unknown as typeof fetch,
    });
    for (const key of ENV_KEYS) delete process.env[key];
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

  it('routes Nostr profile through app-view REST and search through GraphQL', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.test/api/';
    process.env.EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL = 'http://localhost:8080/';

    const { auditMint, fetchNostrProfile, searchUsers } =
      jest.requireActual<typeof import('@/shared/lib/apiClient')>('@/shared/lib/apiClient');

    await fetchNostrProfile(PUBKEY);
    await searchUsers({ query: 'jack' });
    await auditMint({ mintUrl: 'https://mint.example.test' });

    expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([
      `http://localhost:8080/nostr/profile?pubkey=${PUBKEY}`,
      'http://localhost:8080/graphql',
      'https://api.example.test/api/cashu/mint/audit?mintUrl=https%3A%2F%2Fmint.example.test',
    ]);
    expect(JSON.parse(mockFetch.mock.calls[1]?.[1]?.body as string)).toMatchObject({
      operationName: 'ProfileSearch',
      variables: {
        input: {
          query: 'jack',
          limit: 10,
          sort: 'globalPagerank',
        },
      },
    });
  });

  it('parses GraphQL profile search responses through the existing searchUsers schema', async () => {
    process.env.EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL = 'http://localhost:8080/';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          profileSearch: {
            query: 'jack',
            limit: 1,
            sort: 'globalPagerank',
            fromCache: true,
            nodes: [
              {
                pubkey: PUBKEY,
                npub: 'npub1sg6p7p0ak80lh3ugjjvn9yshrmgr4wldxj547gh4t7dkxutj8mnqalaspq',
                rank: 0.01,
                score: null,
                searchRank: 0.2,
                searchScore: 35,
                profileScore: null,
                name: 'jack',
                displayName: null,
                picture: 'https://example.test/avatar.png',
                image: null,
                banner: null,
                about: null,
                nip05: null,
                nip05Valid: null,
                website: null,
                lud16: null,
                lud06: null,
                followers: null,
                follows: null,
                createdAt: '2026-06-01T12:00:00Z',
              },
            ],
          },
        },
      }),
    });

    const { searchUsers } =
      jest.requireActual<typeof import('@/shared/lib/apiClient')>('@/shared/lib/apiClient');

    const result = await searchUsers({ query: 'jack', limit: 1 });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.results[0]).toMatchObject({
        pubkey: PUBKEY,
        score: null,
        name: 'jack',
        created_at: 1780315200,
      });
      expect(result.value.results[0]).not.toHaveProperty('displayName');
    }
  });

  it('routes mint reviews through the Nostr GraphQL endpoint', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.test/api/';
    process.env.EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL = 'http://localhost:8080/';
    mockFetchMintReviews.mockResolvedValueOnce({
      mintUrl: 'https://mint.example.test',
      score: 5,
      recommendations: [
        {
          score: 5,
          comment: 'fast',
          pubkey: PUBKEY,
          eventId: 'c'.repeat(64),
          created_at: 1_710_000_000,
          displayName: 'Reviewer',
          picture: 'https://example.test/reviewer.png',
        },
      ],
      lastUpdated: 1_710_000_000,
      fromCache: true,
    });

    const { reviewMint } =
      jest.requireActual<typeof import('@/shared/lib/apiClient')>('@/shared/lib/apiClient');

    const result = await reviewMint({ mintUrl: 'https://mint.example.test' });

    expect(mockCreateNostrGraphqlMintEnrichment).toHaveBeenCalledWith({
      endpoint: 'http://localhost:8080/graphql',
      timeoutMs: 10_000,
    });
    expect(mockFetchMintReviews).toHaveBeenCalledWith('https://mint.example.test', {
      signal: undefined,
    });
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/cashu/mint/reviews'))).toBe(
      false
    );
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.recommendations[0]).toMatchObject({
        displayName: 'Reviewer',
        picture: 'https://example.test/reviewer.png',
      });
    }
  });
});
