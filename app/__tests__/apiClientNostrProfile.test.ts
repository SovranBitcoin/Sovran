import liveEnvelope from './fixtures/profile-v2-live.json';
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

const FIATJAF = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';
const PUBKEY = '82341f05fdb1dffbc78894993292171ed03abbed34a95f22f55f9b6371723ee6';

const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
const mockFetch = jest.fn();

describe('fetchNostrProfile', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: mockFetch,
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
  it('maps the live envelope into NostrProfileFull', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify(liveEnvelope)));
    const result = await fetchNostrProfile(FIATJAF);
    expect(result.isOk()).toBe(true);
    const p = result._unsafeUnwrap();
    expect(p.pubkey).toBe(FIATJAF);
    expect(p.npub.startsWith('npub1')).toBe(true);
    expect(p.name).toBe('fiatjaf');
    // Vertex provider payload (rank may be 0 on a young graph — presence, not value).
    expect(typeof p.rank).toBe('number');
    // Started date comes from providers.nagg.firstEventAt.
    expect(p.created_at).toBe(1697051805);
    // nip05 validity from the nip05 provider namespace.
    expect(p.nip05Valid).toBe(true);
    // following count from the pubkey-keyed aggregates.
    expect(p.follows).toBeGreaterThan(0);
    // Zero-omitted followers map to 0, not a parse failure.
    expect(typeof p.followers).toBe('number');
  });

  it('rejects a non-envelope body', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ pubkey: FIATJAF })));
    expect((await fetchNostrProfile(FIATJAF)).isErr()).toBe(true);
  });
});
