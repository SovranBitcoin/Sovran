import { describe, test, expect } from 'vitest';
import { ok, type Result } from 'neverthrow';
import { createNaggClient } from '../src/transport';
import {
  createNaggTier,
  createNostrDataLayer,
  summarizeReviews,
  dedupeByReviewer,
  discoverFromReviews,
  parseReviewEvent,
} from '../src/facade';
import { createRelayTier, type RelayConnection, type RawRelayEvent } from '../src/facade/relay';
import type { NaggError } from '../src/errors';

const MINT = 'https://mint.example';
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

function review(id: string, pubkey: string, score: string, created_at: number, mint = MINT) {
  return {
    id,
    pubkey,
    kind: 38_000,
    content: `Great mint [${score}/5]`,
    tags: [['k', '38172'], ['u', mint], ['d', 'x']] as string[][],
    created_at,
  };
}

describe('NIP-87 review parsing', () => {
  test('parses k/u tags and the [n/5] score; rejects non-cashu reviews', () => {
    const r = parseReviewEvent({ id: A, pubkey: A, kind: 38_000, content: 'ok [4/5]', tags: [['k', '38172'], ['u', MINT]], created_at: 1 });
    expect(r).toMatchObject({ mintUrl: MINT, score: 4, reviewerPubkey: A });
    // fedimint (k=38173) → not a cashu mint review
    const notCashu = parseReviewEvent({ id: B, pubkey: B, kind: 38_000, content: '[5/5]', tags: [['k', '38173'], ['u', MINT]], created_at: 1 });
    expect(notCashu).toBeNull();
  });

  test('dedupeByReviewer keeps the latest review per reviewer (anti-spam)', () => {
    const summary = summarizeReviews(MINT, [
      review('1'.repeat(64), A, '5', 100),
      review('2'.repeat(64), A, '4', 200), // newer A → wins
      review('3'.repeat(64), B, '3', 150),
    ]);
    const deduped = dedupeByReviewer(summary.reviews);
    expect(deduped).toHaveLength(2);
    expect(deduped.find((r) => r.reviewerPubkey === A)?.score).toBe(4);
  });

  test('summarizeReviews averages deduped scores for the target mint', () => {
    const summary = summarizeReviews(MINT, [
      review('1'.repeat(64), A, '5', 100),
      review('2'.repeat(64), A, '4', 200),
      review('3'.repeat(64), B, '3', 150),
      review('4'.repeat(64), B, '1', 50, 'https://other.mint'), // different mint → excluded
    ]);
    expect(summary.reviewCount).toBe(2);
    expect(summary.averageScore).toBe(3.5); // (4 + 3) / 2
    expect(summary.reviews[0].createdAt).toBeGreaterThan(summary.reviews[1].createdAt); // newest-first
  });

  test('trailing-slash mint URLs are treated as the same mint', () => {
    const summary = summarizeReviews('https://mint.example/', [review('1'.repeat(64), A, '5', 100)]);
    expect(summary.reviewCount).toBe(1);
  });

  test('discoverFromReviews groups by mint, best-attested first', () => {
    const mints = discoverFromReviews([
      review('1'.repeat(64), A, '5', 100, 'https://m1'),
      review('2'.repeat(64), B, '4', 100, 'https://m1'),
      review('3'.repeat(64), A, '3', 100, 'https://m2'),
    ]);
    expect(mints[0].mintUrl).toBe('https://m1'); // 2 reviews
    expect(mints[0].reviewCount).toBe(2);
  });
});

describe('mint-reviews through the facade', () => {
  function fakeRelay(events: RawRelayEvent[]): RelayConnection {
    return { request: (): Promise<Result<RawRelayEvent[], NaggError>> => Promise.resolve(ok(events)) };
  }

  test('relay floor parses reviews when nagg has no aggregate', async () => {
    // nagg tier returns a 503 for the aggregate → falls through to relay
    const client = createNaggClient({
      appView: { baseUrl: 'https://nagg.test' },
      fetchImpl: (async () =>
        ({ ok: false, status: 503, statusText: 'x', json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch,
    });
    const layer = createNostrDataLayer({
      tiers: [
        createNaggTier({ client }),
        createRelayTier({
          connection: fakeRelay([review('1'.repeat(64), A, '4', 200), review('2'.repeat(64), B, '3', 100)]),
        }),
      ],
    });

    const result = await layer.getMintReviews({ mintUrl: MINT });
    expect(result.isOk()).toBe(true);
    const out = result._unsafeUnwrap();
    expect(out.tier).toBe('relay');
    expect(out.reviewCount).toBe(2);
    expect(out.averageScore).toBe(3.5);
  });

  test('nagg serves the server-side aggregate when available', async () => {
    let lastUrl = '';
    const client = createNaggClient({
      appView: { baseUrl: 'https://nagg.test' },
      fetchImpl: (async (url: string) => {
        lastUrl = String(url);
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ summary: { mintUrl: MINT, averageScore: 4.2, reviewCount: 17 } }),
        } as unknown as Response;
      }) as unknown as typeof fetch,
    });
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client })] });

    const result = await layer.getMintReviews({ mintUrl: MINT });
    expect(result.isOk()).toBe(true);
    const out = result._unsafeUnwrap();
    expect(lastUrl).toContain('/nostr/mint/reviews');
    expect(out.tier).toBe('nagg');
    expect(out.averageScore).toBe(4.2);
    expect(out.reviewCount).toBe(17);
  });

  test('nagg reviews carry individual items + bundled reviewer identity', async () => {
    const client = createNaggClient({
      appView: { baseUrl: 'https://nagg.test' },
      fetchImpl: (async () =>
        ({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            summary: { mintUrl: MINT, averageScore: 5, reviewCount: 1 },
            reviews: [
              { eventId: 'e1', reviewerPubkey: A, mintUrl: MINT, score: 5, content: '[5/5] great', createdAt: 100 },
            ],
            profiles: { [A]: { name: 'Alice', picture: 'https://a/p.png' } },
          }),
        }) as unknown as Response) as unknown as typeof fetch,
    });
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client })] });

    const out = (await layer.getMintReviews({ mintUrl: MINT }))._unsafeUnwrap();
    expect(out.reviews).toHaveLength(1);
    expect(out.reviews[0]).toMatchObject({ score: 5, name: 'Alice', picture: 'https://a/p.png' });
  });

  test('nagg discoverMints maps the rich card shape + operator identity', async () => {
    const client = createNaggClient({
      appView: { baseUrl: 'https://nagg.test' },
      fetchImpl: (async () =>
        ({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            mints: [
              {
                mintUrl: MINT,
                name: 'Mint One',
                supportedUnits: ['sat', 'usd'],
                averageScore: 4.5,
                reviewCount: 3,
                favouriteCount: 1,
                hasAudit: true,
                state: 'OK',
                nMints: 100,
                nMelts: 40,
                nErrors: 2,
                operatorPubkey: A,
                followers: 1234,
              },
            ],
            profiles: { [A]: { name: 'Operator', picture: 'https://op/p.png' } },
          }),
        }) as unknown as Response) as unknown as typeof fetch,
    });
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client })] });

    const out = (await layer.discoverMints({}))._unsafeUnwrap();
    expect(out.mints).toHaveLength(1);
    expect(out.mints[0]).toMatchObject({
      mintUrl: MINT,
      supportedUnits: ['sat', 'usd'],
      favouriteCount: 1,
      hasAudit: true,
      state: 'OK',
      nMints: 100,
      operatorPubkey: A,
      operatorName: 'Operator',
      operatorPicture: 'https://op/p.png',
      followers: 1234,
    });
  });
});
