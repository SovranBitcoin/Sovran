import { describe, test, expect } from 'vitest';
import { createNaggClient } from '../src/transport';
import { createNaggTier, createNostrDataLayer } from '../src/facade';

const TARGET = 'a'.repeat(64);
const REPLY = 'b'.repeat(64);
const PUB = 'c'.repeat(64);
const ACTOR = 'd'.repeat(64);

function event(id: string, created_at: number) {
  return { id, kind: 1, pubkey: PUB, content: `e ${id}`, tags: [], created_at };
}

const PAGE = {
  notifications: {
    nodes: [
      {
        type: 'group',
        event: event(TARGET, 1_700_000_200),
        reason: 'reaction',
        actorVertexScore: 0,
        total: 12,
        totalCapped: false,
        sampleActors: [{ pubkey: ACTOR, eventId: 'f'.repeat(64), createdAt: 1_700_000_200 }],
        targetEventId: TARGET,
      },
      {
        type: 'single',
        event: event(REPLY, 1_700_000_100),
        reason: 'reply',
        actorVertexScore: 0,
      },
    ],
    pageInfo: { hasNextPage: false },
  },
  metrics: {
    [TARGET]: { likeCount: 12, repostCount: 0, replyCount: 1, satsZapped: 0 },
    [REPLY]: { likeCount: 0, repostCount: 0, replyCount: 0, satsZapped: 0 },
  },
  profiles: { [PUB]: { name: 'alice' } },
  quoted: {},
};

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: 'OK',
    json: async () => body,
  } as unknown as Response;
}

function naggClientReturning(body: unknown) {
  let lastUrl = '';
  const client = createNaggClient({
    endpoint: 'https://nagg.test/graphql',
    appView: { baseUrl: 'https://nagg.test' },
    transport: 'appview',
    fetchImpl: (async (url: string) => {
      lastUrl = String(url);
      return jsonResponse(body);
    }) as unknown as typeof fetch,
  });
  return { client, urlOf: () => lastUrl };
}

describe('NostrDataLayer.getNotifications — nagg tier', () => {
  test('returns grouped notifications in manifest order with the grouped flag', async () => {
    const { client, urlOf } = naggClientReturning(PAGE);
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client })] });

    const result = await layer.getNotifications({ viewerPubkey: PUB });
    expect(result.isOk()).toBe(true);
    const out = result._unsafeUnwrap();

    expect(urlOf()).toContain('/nostr/notifications');
    expect(urlOf()).toContain('pubkey=' + PUB);
    expect(out.grouped).toBe(true);
    expect(out.notifications).toHaveLength(2);
    const first = out.notifications[0];
    expect(first.type).toBe('group');
    expect(first.reason).toBe('reaction');
    expect(first.total).toBe(12);
    expect(first.sampleActors?.[0]?.pubkey).toBe(ACTOR);
    // stats hydrated alongside
    expect(out.stats[TARGET]?.likes).toBe(12);
  });

  test('grouped:false reads the raw ungrouped list (flag carried through)', async () => {
    const { client, urlOf } = naggClientReturning(PAGE);
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client })] });

    const result = await layer.getNotifications({ viewerPubkey: PUB, grouped: false });
    expect(result._unsafeUnwrap().grouped).toBe(false);
    expect(urlOf()).toContain('grouped=false');
  });
});
