/** @jest-environment node */
import {
  fetchDmEnvelopes,
  subscribeDmEnvelopesLive,
} from '@/features/payments/data/dmEnvelopeClient';

// The DM inbox transport at its two edges: exactly what it asks the payment
// inbox for, and exactly the page it hands back for fetched and live wraps.
// It reads the payment inbox, never the social data layer, so a tier switched
// off in Settings → Network cannot stop ecash arriving (audit D16).
type Resolved = {
  tier: string;
  envelopes: unknown[];
  cursor: null | { createdAt: number; id: string };
  received?: number;
};
let mockOutcome: { ok: Resolved } | { err: { attempts: { tier: string; outcome: string }[] } };
const mockGet = jest.fn();
const mockSubscribe = jest.fn();

const mockBuildSocialLayer = jest.fn(() => null);
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => mockBuildSocialLayer(),
}));
jest.mock('@/shared/lib/nostr/paymentInbox', () => ({
  getPaymentInbox: () => ({
    getDmEnvelopes: async (request: unknown) => {
      mockGet(request);
      return {
        match: (ok: (value: Resolved) => unknown, err: (error: unknown) => unknown) =>
          'ok' in mockOutcome ? ok(mockOutcome.ok) : err(mockOutcome.err),
      };
    },
    subscribeDmEnvelopes: (...args: unknown[]) => mockSubscribe(...args),
  }),
}));
jest.mock('@/shared/lib/logger', () => ({ paymentLog: { debug: jest.fn() } }));

const signed = {
  id: 'wrap-1',
  pubkey: 'a'.repeat(64),
  kind: 1059,
  createdAtSec: 1_700_000_000,
  content: 'ciphertext',
  tags: [['p', 'b'.repeat(64)]],
  sig: 'sig-1',
};
const unsigned = { ...signed, id: 'legacy-1', kind: 4, createdAtSec: 1_699_999_999, sig: '' };
const asEnvelope = (wrap: typeof signed) => ({
  id: wrap.id,
  pubkey: wrap.pubkey,
  kind: wrap.kind,
  createdAt: wrap.createdAtSec,
  content: wrap.content,
  tags: wrap.tags,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockOutcome = { ok: { tier: 'nagg', envelopes: [], cursor: null } };
});

describe('fetchDmEnvelopes', () => {
  it('asks for a page behind the until cursor with every option it was given', async () => {
    const signal = new AbortController().signal;
    await fetchDmEnvelopes({
      viewer: 'viewer',
      until: 900,
      limit: 50,
      refresh: true,
      signal,
      readId: 'read-1',
    });
    expect(mockGet.mock.calls).toStrictEqual([
      [
        {
          viewerPubkey: 'viewer',
          cursor: { createdAt: 900, id: '' },
          limit: 50,
          refresh: true,
          signal,
          readId: 'read-1',
        },
      ],
    ]);
  });

  it('leaves out every option it was not given, and a refresh that is off', async () => {
    await fetchDmEnvelopes({ viewer: 'viewer', refresh: false });
    expect(mockGet.mock.calls).toStrictEqual([[{ viewerPubkey: 'viewer' }]]);
  });

  it('passes a since bound through, for a caller that has already read the inbox', async () => {
    await fetchDmEnvelopes({ viewer: 'viewer', since: 1_699_000_000 });
    expect(mockGet.mock.calls).toStrictEqual([[{ viewerPubkey: 'viewer', since: 1_699_000_000 }]]);
  });

  it('never reads through the social data layer, which Settings → Network can switch off', async () => {
    await fetchDmEnvelopes({ viewer: 'viewer' });
    subscribeDmEnvelopesLive('viewer', jest.fn());
    expect(mockBuildSocialLayer).not.toHaveBeenCalled();
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
  });

  it('hands back the wraps in arrival order with their times, signatures and received count', async () => {
    mockOutcome = {
      ok: {
        tier: 'nagg',
        envelopes: [signed, unsigned],
        cursor: { createdAt: 1_699_999_999, id: 'legacy-1' },
        received: 3,
      },
    };
    await expect(fetchDmEnvelopes({ viewer: 'viewer' })).resolves.toStrictEqual({
      envelopes: [{ ...asEnvelope(signed), sig: 'sig-1' }, asEnvelope(unsigned)],
      hasNextPage: true,
      received: 3,
    });
  });

  it('treats a relay answer (no cursor) as the last page: the relay has sent all it holds', async () => {
    mockOutcome = { ok: { tier: 'relay', envelopes: [signed, unsigned], cursor: null } };
    await expect(fetchDmEnvelopes({ viewer: 'viewer' })).resolves.toMatchObject({
      hasNextPage: false,
    });
  });

  it('reports an empty answer as the end, without a received count it was not given', async () => {
    await expect(fetchDmEnvelopes({ viewer: 'viewer' })).resolves.toStrictEqual({
      envelopes: [],
      hasNextPage: false,
    });
  });

  it('fails when every tier was exhausted', async () => {
    mockOutcome = { err: { attempts: [{ tier: 'nagg', outcome: 'down' }] } };
    await expect(fetchDmEnvelopes({ viewer: 'viewer' })).rejects.toThrow(
      'Message history is unavailable'
    );
  });
});

describe('subscribeDmEnvelopesLive', () => {
  it('delivers each live wrap as a one-envelope page', () => {
    const unsubscribe = jest.fn();
    mockSubscribe.mockReturnValue(unsubscribe);
    const onPage = jest.fn();
    expect(subscribeDmEnvelopesLive('viewer', onPage)).toBe(unsubscribe);
    expect(mockSubscribe).toHaveBeenCalledWith({ viewerPubkey: 'viewer' }, expect.any(Function));
    mockSubscribe.mock.calls[0][1](signed);
    expect(onPage.mock.calls).toStrictEqual([
      [{ envelopes: [{ ...asEnvelope(signed), sig: 'sig-1' }], hasNextPage: false }],
    ]);
  });
});
