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

  it('keeps every server review (scored + score-less), trusts the server score, and attaches reviewer identity', async () => {
    const mintUrl = 'https://mint.example.com';
    const reviewerB = 'd'.repeat(64);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        summary: { mintUrl, averageScore: 4.5, reviewCount: 2 },
        reviews: [
          {
            eventId: EVENT_ID,
            reviewerPubkey: REVIEWER,
            mintUrl,
            score: 4, // decimal/loose forms are parsed server-side; trust it
            content: '[4/5] fast and reliable',
            createdAt: 1780000000,
          },
          {
            eventId: 'e'.repeat(64),
            reviewerPubkey: reviewerB,
            mintUrl,
            score: null, // a score-less recommendation — must NOT be dropped
            content: 'great mint',
            createdAt: 1780000100,
          },
        ],
        profiles: {
          [REVIEWER]: { name: 'Alice', picture: 'https://a/pic.png' },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const enrichment = createNostrMintEnrichment({ appViewBaseUrl: BASE_URL });
    const reviews = await enrichment.fetchMintReviews(mintUrl);

    expect(reviews?.score).toBe(4.5);
    // count comes from the server summary, NOT recommendations.length
    expect(reviews?.reviewCount).toBe(2);
    // both reviews kept → list is 1:1 with summary.reviewCount (no re-filtering)
    expect(reviews?.recommendations).toHaveLength(2);
    // newest first: the score-less recommendation
    expect(reviews?.recommendations[0]).toMatchObject({
      score: null,
      comment: 'great mint',
      pubkey: reviewerB,
    });
    // scored review: server score used, [n/5] marker stripped, identity +
    // passthrough fields (eventId / created_at) attached
    expect(reviews?.recommendations[1]).toMatchObject({
      score: 4,
      comment: 'fast and reliable',
      pubkey: REVIEWER,
      eventId: EVENT_ID,
      created_at: 1780000000,
      name: 'Alice',
      picture: 'https://a/pic.png',
    });
    expect(reviews?.lastUpdated).toBe(1780000100);

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe('/v1/nostr/mint/reviews');
    expect(url.searchParams.get('u')).toBe(mintUrl);
    expect(url.searchParams.get('limit')).toBe('100');
  });

  it('clamps out-of-range scores to 0–5 at the trust boundary', async () => {
    const mintUrl = 'https://mint.example.com';
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        // a server bug / malformed upstream event must never render a 42/5 mint
        summary: { mintUrl, averageScore: 9, reviewCount: 2 },
        reviews: [
          {
            eventId: EVENT_ID,
            reviewerPubkey: REVIEWER,
            mintUrl,
            score: 42,
            content: 'over the top',
            createdAt: 1780000000,
          },
          {
            eventId: 'e'.repeat(64),
            reviewerPubkey: 'd'.repeat(64),
            mintUrl,
            score: -3,
            content: 'under the floor',
            createdAt: 1779999000,
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const enrichment = createNostrMintEnrichment({ appViewBaseUrl: BASE_URL });
    const reviews = await enrichment.fetchMintReviews(mintUrl);

    expect(reviews?.score).toBe(5); // averageScore 9 → clamped
    expect(reviews?.recommendations[0]).toMatchObject({ score: 5 }); // 42 → 5
    expect(reviews?.recommendations[1]).toMatchObject({ score: 0 }); // -3 → 0
  });
});

// A nagg running NAGG_MODULES=mint serves /nostr/mint/* off a tiny ClickHouse
// but does NOT mount /nostr/profile — that route reads pubkey_stats and the
// follower graph, which belong to the nostr module. Pointing the whole client
// at a mint-only host therefore 404s every operator lookup.
describe('split hosts', () => {
  const MINT_URL_HOST = 'https://nagg-mint.example.com';

  it('sends the profile lookup to profileBaseUrl and reviews to appViewBaseUrl', async () => {
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/nostr/profile')) {
        return Promise.resolve(jsonResponse({ pubkey: PUBKEY, name: 'operator' }));
      }
      return Promise.resolve(
        jsonResponse({
          summary: { mintUrl: 'https://mint.example.com', averageScore: 5, reviewCount: 0 },
          reviews: [],
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const enrichment = createNostrMintEnrichment({
      appViewBaseUrl: MINT_URL_HOST,
      profileBaseUrl: BASE_URL,
    });
    await enrichment.resolveMintContactProfile(PUBKEY, 'https://mint.example.com');
    await enrichment.fetchMintReviews('https://mint.example.com');

    const profileUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(profileUrl.origin).toBe(BASE_URL);
    expect(profileUrl.pathname).toBe('/v1/nostr/profile');

    const reviewsUrl = new URL(fetchMock.mock.calls[1][0]);
    expect(reviewsUrl.origin).toBe(MINT_URL_HOST);
    expect(reviewsUrl.pathname).toBe('/v1/nostr/mint/reviews');
  });

  it('defaults profileBaseUrl to appViewBaseUrl so a single-host setup is unchanged', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ pubkey: PUBKEY, name: 'operator' }));
    vi.stubGlobal('fetch', fetchMock);

    const enrichment = createNostrMintEnrichment({ appViewBaseUrl: BASE_URL });
    await enrichment.resolveMintContactProfile(PUBKEY, 'https://mint.example.com');

    expect(new URL(fetchMock.mock.calls[0][0]).origin).toBe(BASE_URL);
  });
});
