const mockFetchMintReviews = jest.fn();
const mockCreateNostrMintEnrichment = jest.fn(() => ({
  fetchMintReviews: mockFetchMintReviews,
  resolveMintContactProfile: jest.fn(),
}));

jest.mock('wallet', () => ({
  combineSignals: (...signals: (AbortSignal | undefined)[]) =>
    signals.find((signal): signal is AbortSignal => !!signal) ?? new AbortController().signal,
  createNostrMintEnrichment: mockCreateNostrMintEnrichment,
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
    mockCreateNostrMintEnrichment.mockClear();
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

  it('routes Nostr profile through app-view REST', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.test/api/';
    process.env.EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL = 'http://localhost:8080/';

    const { auditMint, fetchNostrProfile } =
      jest.requireActual<typeof import('@/shared/lib/apiClient')>('@/shared/lib/apiClient');

    await fetchNostrProfile(PUBKEY);
    await auditMint({ mintUrl: 'https://mint.example.test' });

    // Profile search moved to the tier-selecting facade (searchProfilesViaFacade),
    // so apiClient no longer issues a GraphQL ProfileSearch here.
    expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([
      `http://localhost:8080/nostr/profile?pubkey=${PUBKEY}`,
      'https://api.example.test/api/cashu/mint/audit?mintUrl=https%3A%2F%2Fmint.example.test',
    ]);
  });

  it('routes mint reviews through the REST app-view', async () => {
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

    // Two hosts: /nostr/mint/reviews follows the mint app-view, but the operator
    // lookup the same client makes is /nostr/profile, which a mint-only nagg
    // does not mount. With EXPO_PUBLIC_MINT_APPVIEW_BASE_URL unset both resolve
    // to the same base.
    expect(mockCreateNostrMintEnrichment).toHaveBeenCalledWith({
      appViewBaseUrl: 'http://localhost:8080',
      profileBaseUrl: 'http://localhost:8080',
      appViewVersion: 'v1',
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
