import { fetchNostrProfile } from '@/shared/lib/apiClient';

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

const PUBKEY = '82341f05fdb1dffbc78894993292171ed03abbed34a95f22f55f9b6371723ee6';

const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
const mockFetch = jest.fn();

describe('fetchNostrProfile', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: mockFetch as unknown as typeof fetch,
    });
  });

  afterAll(() => {
    if (originalFetchDescriptor) {
      Object.defineProperty(globalThis, 'fetch', originalFetchDescriptor);
      return;
    }
    Reflect.deleteProperty(globalThis, 'fetch');
  });

  it('accepts a v2 envelope with absent Vertex metrics (score/created_at map to null)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      // nagg v2 providers envelope: a young pubkey with no vertex score and no
      // nagg firstEventAt — the mapper must yield nulls, not a parse failure.
      json: async () => ({
        events: [],
        aggregates: {},
        providers: {
          [PUBKEY]: {
            vertex: { rank: 0, nodes: 502075 },
          },
        },
        fromCache: false,
      }),
    });

    const result = await fetchNostrProfile(PUBKEY);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.score).toBeNull();
      expect(result.value.created_at).toBeNull();
      expect(result.value.followers).toBe(0);
    }
  });
});
