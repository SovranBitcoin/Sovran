import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNostrGraphqlMintEnrichment } from '../../src/nostr-graphql';

const ENDPOINT = 'https://nostr-index.example.com/graphql';
const PUBKEY = 'a'.repeat(64);
const REVIEWER = 'b'.repeat(64);
const EVENT_ID = 'c'.repeat(64);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createNostrGraphqlMintEnrichment', () => {
  it('resolves mint contact profile metadata through generic GraphQL events', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          events: {
            nodes: [
              {
                id: 'profile-event',
                pubkey: PUBKEY,
                kind: 0,
                createdAt: '2026-06-01T12:00:00Z',
                content: JSON.stringify({
                  name: 'operator',
                  display_name: 'Mint Operator',
                  picture: 'https://example.com/operator.png',
                }),
                tags: [],
              },
            ],
          },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const enrichment = createNostrGraphqlMintEnrichment({ endpoint: ENDPOINT });
    const profile = await enrichment.resolveMintContactProfile(PUBKEY, 'https://mint.example.com');

    expect(profile).toMatchObject({
      pubkey: PUBKEY,
      name: 'operator',
      displayName: 'Mint Operator',
      picture: 'https://example.com/operator.png',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      ENDPOINT,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.variables).toEqual({ pubkey: PUBKEY });
  });

  it('fetches mint reviews and reviewer profiles through generic GraphQL events', async () => {
    const mintUrl = 'https://mint.example.com';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          events: {
            nodes: [
              {
                id: EVENT_ID,
                pubkey: REVIEWER,
                kind: 38000,
                createdAt: '2026-06-01T12:00:00Z',
                content: '[5/5] fast and reliable',
                tags: [
                  ['k', '38172'],
                  ['u', mintUrl],
                ],
                pubkeyEvents: [
                  {
                    id: 'reviewer-profile',
                    pubkey: REVIEWER,
                    kind: 0,
                    createdAt: '2026-06-01T11:00:00Z',
                    content: JSON.stringify({
                      display_name: 'Reviewer Name',
                      picture: 'https://example.com/reviewer.png',
                    }),
                    tags: [],
                  },
                ],
              },
              {
                id: 'not-review',
                pubkey: REVIEWER,
                kind: 38000,
                createdAt: '2026-06-01T12:00:01Z',
                content: 'not a score',
                tags: [
                  ['k', '38172'],
                  ['u', mintUrl],
                ],
                pubkeyEvents: [],
              },
            ],
          },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const enrichment = createNostrGraphqlMintEnrichment({ endpoint: ENDPOINT });
    const reviews = await enrichment.fetchMintReviews(mintUrl);

    expect(reviews?.score).toBe(5);
    expect(reviews?.recommendations).toHaveLength(1);
    expect(reviews?.recommendations[0]).toMatchObject({
      score: 5,
      comment: 'fast and reliable',
      pubkey: REVIEWER,
      eventId: EVENT_ID,
      displayName: 'Reviewer Name',
      picture: 'https://example.com/reviewer.png',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.variables).toEqual({
      mintUrls: [mintUrl, `${mintUrl}/`],
      limit: 100,
    });
  });
});
