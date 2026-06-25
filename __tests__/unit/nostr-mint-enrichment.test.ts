import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNostrMintEnrichment } from '../../src/nostr-mint-enrichment';

const BASE_URL = 'https://nagg.example.com';
const PUBKEY = 'a'.repeat(64);
const REVIEWER = 'b'.repeat(64);
const EVENT_ID = 'c'.repeat(64);

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createNostrMintEnrichment', () => {
  it('resolves mint contact profile metadata through the REST app-view', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        pubkey: PUBKEY,
        name: 'operator',
        displayName: 'Mint Operator',
        picture: 'https://example.com/operator.png',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const enrichment = createNostrMintEnrichment({ appViewBaseUrl: BASE_URL });
    const profile = await enrichment.resolveMintContactProfile(
      PUBKEY,
      'https://mint.example.com',
    );

    expect(profile).toMatchObject({
      pubkey: PUBKEY,
      name: 'operator',
      displayName: 'Mint Operator',
      picture: 'https://example.com/operator.png',
    });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe('/v1/nostr/profile');
    expect(url.searchParams.get('pubkey')).toBe(PUBKEY);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET' });
  });

  it('fetches mint reviews and recommendations from the REST aggregate', async () => {
    const mintUrl = 'https://mint.example.com';
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        summary: { mintUrl, averageScore: 4.5, reviewCount: 2 },
        reviews: [
          {
            eventId: EVENT_ID,
            reviewerPubkey: REVIEWER,
            mintUrl,
            score: 5,
            content: '[5/5] fast and reliable',
            createdAt: 1780000000,
          },
          {
            eventId: 'not-a-review',
            reviewerPubkey: REVIEWER,
            mintUrl,
            score: null,
            content: 'great mint',
            createdAt: 1780000100,
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const enrichment = createNostrMintEnrichment({ appViewBaseUrl: BASE_URL });
    const reviews = await enrichment.fetchMintReviews(mintUrl);

    expect(reviews?.score).toBe(4.5);
    expect(reviews?.mintUrl).toBe(mintUrl);
    expect(reviews?.recommendations).toHaveLength(1);
    expect(reviews?.recommendations[0]).toMatchObject({
      score: 5,
      comment: 'fast and reliable',
      pubkey: REVIEWER,
      eventId: EVENT_ID,
      created_at: 1780000000,
    });
    expect(reviews?.lastUpdated).toBe(1780000000);

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe('/v1/nostr/mint/reviews');
    expect(url.searchParams.get('u')).toBe(mintUrl);
    expect(url.searchParams.get('limit')).toBe('100');
  });
});
