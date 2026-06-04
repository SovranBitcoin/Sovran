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
const pubkey = (char: string) => char.repeat(64);

describe('recent people GraphQL profiles', () => {
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

  it('builds a kind-0 events query for normalized pubkeys', () => {
    const { buildRecentPeopleProfilesGraphqlBody } = jest.requireActual<
      typeof import('@/features/feed/data/recentPeopleProfiles')
    >('@/features/feed/data/recentPeopleProfiles');

    const body = buildRecentPeopleProfilesGraphqlBody([
      pubkey('A'),
      pubkey('b'),
      pubkey('b'),
      'placeholder-1',
    ]);

    expect(body.query).toContain('events(input: $input)');
    expect(body.variables.input).toEqual({
      kinds: [0],
      pubkeys: [pubkey('a'), pubkey('b')],
      limit: 8,
    });
  });

  it('maps the newest kind-0 metadata per pubkey', () => {
    const { mapRecentPeopleProfileEvents } = jest.requireActual<
      typeof import('@/features/feed/data/recentPeopleProfiles')
    >('@/features/feed/data/recentPeopleProfiles');

    expect(
      mapRecentPeopleProfileEvents([
        {
          id: 'old',
          kind: 0,
          pubkey: pubkey('a'),
          createdAt: 100,
          content: JSON.stringify({ name: 'Old Alice', picture: 'old.png' }),
          tags: [],
        },
        {
          id: 'new',
          kind: 0,
          pubkey: pubkey('a'),
          createdAt: 200,
          content: JSON.stringify({
            display_name: 'Alice',
            name: 'alice',
            picture: 'alice.png',
            nip05: 'alice@example.test',
          }),
          tags: [],
        },
        {
          id: 'not-profile',
          kind: 1,
          pubkey: pubkey('b'),
          createdAt: 300,
          content: 'hello',
          tags: [],
        },
      ])
    ).toEqual({
      [pubkey('a')]: {
        displayName: 'Alice',
        name: 'alice',
        picture: 'alice.png',
        nip05: 'alice@example.test',
      },
    });
  });

  it('posts profile lookups to the configured GraphQL endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          events: {
            nodes: [
              {
                id: 'profile-alice',
                kind: 0,
                pubkey: pubkey('a'),
                createdAt: 123,
                content: JSON.stringify({ name: 'Alice' }),
                tags: [],
              },
            ],
          },
        },
      }),
    });

    const { fetchRecentPeopleProfiles } = jest.requireActual<
      typeof import('@/features/feed/data/recentPeopleProfiles')
    >('@/features/feed/data/recentPeopleProfiles');

    const result = await fetchRecentPeopleProfiles([pubkey('a')]);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ [pubkey('a')]: { name: 'Alice' } });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://nagg.test/graphql',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      })
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.variables.input).toEqual({
      kinds: [0],
      pubkeys: [pubkey('a')],
      limit: 4,
    });
  });
});
