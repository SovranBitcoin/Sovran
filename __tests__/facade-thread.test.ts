import { describe, test, expect } from 'vitest';
import { createNaggClient } from '../src/transport';
import { createNaggTier, createNostrDataLayer, pendingFeedTier } from '../src/facade';

const ROOT = 'a'.repeat(64);
const R1 = 'b'.repeat(64);
const R2 = 'e'.repeat(64);
const PUB = 'c'.repeat(64);

function event(id: string, created_at: number) {
  return { id, kind: 1, pubkey: PUB, content: `e ${id}`, tags: [], created_at };
}

const THREAD = {
  root: event(ROOT, 1_700_000_000),
  events: [event(R1, 1_700_000_100), event(R2, 1_700_000_200)],
  metrics: {
    [ROOT]: { likeCount: 9, repostCount: 0, replyCount: 2, satsZapped: 0 },
    [R1]: { likeCount: 1, repostCount: 0, replyCount: 0, satsZapped: 0 },
    [R2]: { likeCount: 0, repostCount: 0, replyCount: 0, satsZapped: 0 },
  },
  profiles: { [PUB]: { name: 'alice' } },
  quoted: {},
};

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.ok === false ? 'Server Error' : 'OK',
    json: async () => body,
  } as unknown as Response;
}

function naggClientReturning(body: unknown, init?: { ok?: boolean; status?: number }) {
  let lastUrl = '';
  const client = createNaggClient({
    endpoint: 'https://nagg.test/graphql',
    appView: { baseUrl: 'https://nagg.test' },
    transport: 'appview',
    fetchImpl: (async (url: string) => {
      lastUrl = String(url);
      return jsonResponse(body, init);
    }) as unknown as typeof fetch,
  });
  return { client, urlOf: () => lastUrl };
}

describe('NostrDataLayer.getThread — nagg tier', () => {
  test('returns the root plus manifest-ordered replies, stats mapped', async () => {
    const { client, urlOf } = naggClientReturning(THREAD);
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client })] });

    const result = await layer.getThread({ noteId: ROOT });
    expect(result.isOk()).toBe(true);
    const thread = result._unsafeUnwrap();

    expect(urlOf()).toContain('/nostr/thread');
    expect(thread.tier).toBe('nagg');
    expect(thread.root.type === 'note' && thread.root.event.id).toBe(ROOT);
    expect(thread.replies.map((r) => (r.type === 'note' ? r.event.id : ''))).toEqual([R1, R2]);
    expect(thread.stats[ROOT]).toEqual({ likes: 9, reposts: 0, replies: 2, zaps: 0, satsZapped: 0 });
  });

  test('a feed-only tier is skipped for thread reads (not in the attempt trail)', async () => {
    const { client } = naggClientReturning({}, { ok: false, status: 503 });
    const layer = createNostrDataLayer({
      // pendingFeedTier implements feedPage only → must NOT appear when resolving a thread
      tiers: [pendingFeedTier('primal'), createNaggTier({ client })],
    });

    const result = await layer.getThread({ noteId: ROOT });
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.attempts.map((a) => a.tier)).toEqual(['nagg']);
  });
});
