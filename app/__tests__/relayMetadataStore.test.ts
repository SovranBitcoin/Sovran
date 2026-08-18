/**
 * Persisted NIP-11 relay-metadata cache: tolerant document schema (verbatim
 * buzz.cashu.space doc), SWR hit/miss/negative-cache behavior, in-flight
 * dedupe, merged composer content limit, and LRU eviction.
 */
/* eslint-disable import/first */

const mockAsyncStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((k: string) => Promise.resolve(mockAsyncStore.get(k) ?? null)),
  setItem: jest.fn((k: string, v: string) => {
    mockAsyncStore.set(k, v);
    return Promise.resolve();
  }),
  removeItem: jest.fn((k: string) => {
    mockAsyncStore.delete(k);
    return Promise.resolve();
  }),
}));

import { RelayInformationSchema } from '@/shared/lib/nostr/nip11';
import {
  getCachedRelayInfo,
  getMergedContentLimit,
  relayMetadataKey,
  useRelayMetadataStore,
} from '@/shared/stores/global/relayMetadataStore';

// Verbatim wss://buzz.cashu.space NIP-11 document (icon data-URI shortened —
// the real one is a 2.7KB base64 PNG; the scheme is what the schema sees).
const BUZZ_NIP11 = {
  name: 'Buzz Relay',
  description: 'Buzz — private team communication relay',
  icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
  pubkey: null,
  contact: null,
  supported_nips: [1, 2, 10, 11, 16, 17, 23, 25, 29, 33, 38, 42, 50, 56],
  supported_extensions: ['nip-er', 'nip-pl'],
  software: 'https://github.com/block/buzz',
  version: '0.2.0',
  limitation: {
    max_message_length: 524288,
    max_subscriptions: 1024,
    max_filters: 10,
    max_limit: 10000,
    max_subid_length: 256,
    min_pow_difficulty: null,
    auth_required: true,
    payment_required: false,
    restricted_writes: true,
    due_delivery_mode: 'push',
  },
  self: '6bfbb0787eb73384085d86b920096fcfa970770f9478340b2760f74de6371c38',
};

const RELAY = 'wss://buzz.cashu.space';

function okResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) };
}

const fetchMock = jest.fn();

beforeEach(() => {
  mockAsyncStore.clear();
  useRelayMetadataStore.setState({ byRelayUrl: {} });
  fetchMock.mockReset();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

describe('RelayInformationSchema', () => {
  it('parses the buzz document, preserving policy fields and explicit nulls', () => {
    const parsed = RelayInformationSchema.parse(BUZZ_NIP11);
    expect(parsed.name).toBe('Buzz Relay');
    expect(parsed.pubkey).toBeNull();
    expect(parsed.software).toBe('https://github.com/block/buzz');
    expect(parsed.supported_extensions).toEqual(['nip-er', 'nip-pl']);
    expect(parsed.limitation?.auth_required).toBe(true);
    expect(parsed.limitation?.restricted_writes).toBe(true);
    expect(parsed.limitation?.payment_required).toBe(false);
    expect(parsed.limitation?.max_message_length).toBe(524288);
  });

  it('drops a malformed field without rejecting the document', () => {
    const parsed = RelayInformationSchema.parse({ ...BUZZ_NIP11, supported_nips: 'nope' });
    expect(parsed.supported_nips).toBeUndefined();
    expect(parsed.name).toBe('Buzz Relay');
  });
});

describe('getCachedRelayInfo SWR', () => {
  it('miss → fetches, writes through, and stamps fetchedAt', async () => {
    fetchMock.mockResolvedValue(okResponse(BUZZ_NIP11));
    const info = await getCachedRelayInfo(RELAY);
    expect(info?.name).toBe('Buzz Relay');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // NIP-11 is served over the https origin of the wss url.
    expect(fetchMock.mock.calls[0][0]).toBe('https://buzz.cashu.space');
    const entry = useRelayMetadataStore.getState().byRelayUrl[relayMetadataKey(RELAY)];
    expect(typeof entry?.fetchedAt).toBe('number');
  });

  it('fresh hit → returns the cached document without a network call', async () => {
    fetchMock.mockResolvedValue(okResponse(BUZZ_NIP11));
    await getCachedRelayInfo(RELAY);
    const again = await getCachedRelayInfo(RELAY);
    expect(again?.name).toBe('Buzz Relay');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('concurrent misses dedupe to one fetch', async () => {
    fetchMock.mockResolvedValue(okResponse(BUZZ_NIP11));
    const [a, b] = await Promise.all([getCachedRelayInfo(RELAY), getCachedRelayInfo(RELAY)]);
    expect(a?.name).toBe('Buzz Relay');
    expect(b?.name).toBe('Buzz Relay');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('failure → undefined, failedAt stamped, retry suppressed inside the window', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    const info = await getCachedRelayInfo(RELAY);
    expect(info).toBeUndefined();
    const entry = useRelayMetadataStore.getState().byRelayUrl[relayMetadataKey(RELAY)];
    expect(typeof entry?.failedAt).toBe('number');
    const second = await getCachedRelayInfo(RELAY);
    expect(second).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1); // negative cache: no second attempt
  });

  it('a later success clears the unreachable stamp', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    await getCachedRelayInfo(RELAY);
    // Age the failure past the retry window.
    useRelayMetadataStore.setState(() => ({
      byRelayUrl: { [relayMetadataKey(RELAY)]: { failedAt: Date.now() - 11 * 60 * 1000 } },
    }));
    fetchMock.mockResolvedValue(okResponse(BUZZ_NIP11));
    const info = await getCachedRelayInfo(RELAY);
    expect(info?.name).toBe('Buzz Relay');
    const entry = useRelayMetadataStore.getState().byRelayUrl[relayMetadataKey(RELAY)];
    expect(entry?.failedAt).toBeUndefined();
  });
});

describe('getMergedContentLimit', () => {
  it('returns the tightest advertised max_content_length', async () => {
    const docFor: Record<string, unknown> = {
      'https://a.example': { limitation: { max_content_length: 5000 } },
      'https://b.example': { limitation: { max_content_length: 2000 } },
      'https://c.example': {},
    };
    fetchMock.mockImplementation((url: string) => Promise.resolve(okResponse(docFor[url] ?? {})));
    await expect(
      getMergedContentLimit(['wss://a.example', 'wss://b.example', 'wss://c.example'])
    ).resolves.toBe(2000);
  });

  it('returns undefined when no relay advertises a limit', async () => {
    fetchMock.mockResolvedValue(okResponse({}));
    await expect(getMergedContentLimit(['wss://a.example'])).resolves.toBeUndefined();
  });
});

describe('LRU eviction', () => {
  it('caps the map near MAX_ENTRIES, evicting the least-recently-touched', () => {
    const { setInfo } = useRelayMetadataStore.getState();
    for (let i = 0; i < 210; i++) setInfo(`wss://relay-${i}.example`, { name: `r${i}` });
    const byRelayUrl = useRelayMetadataStore.getState().byRelayUrl;
    expect(Object.keys(byRelayUrl).length).toBeLessThanOrEqual(200);
    // The most recent write always survives.
    expect(byRelayUrl[relayMetadataKey('wss://relay-209.example')]).toBeDefined();
  });
});
