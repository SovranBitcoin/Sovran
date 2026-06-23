import { describe, test, expect } from 'vitest';
import { ok, type Result } from 'neverthrow';
import { createNaggClient } from '../src/transport';
import { createNaggTier, createNostrDataLayer, pendingFeedTier } from '../src/facade';
import { createRelayTier, type RelayConnection, type RawRelayEvent } from '../src/facade/relay';
import type { NaggError } from '../src/errors';

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

describe('relay notifications — flat floor + ownership gate', () => {
  const ME = 'a'.repeat(64);
  const ACTOR = 'b'.repeat(64);
  const MYEVENT = 'e'.repeat(64);
  const OTHER = 'f'.repeat(64);

  function relayEvent(id: string, kind: number, target: string, created_at: number): RawRelayEvent {
    return { id, pubkey: ACTOR, kind, tags: [['e', target], ['p', ME]], created_at };
  }
  function fakeRelay(events: RawRelayEvent[]): RelayConnection {
    return { request: (): Promise<Result<RawRelayEvent[], NaggError>> => Promise.resolve(ok(events)) };
  }

  test('produces a flat, newest-first list and degrades grouped to false', async () => {
    const layer = createNostrDataLayer({
      tiers: [
        pendingFeedTier('nagg'),
        createRelayTier({
          connection: fakeRelay([
            relayEvent('1'.repeat(64), 7, MYEVENT, 300), // reaction
            relayEvent('2'.repeat(64), 1, MYEVENT, 200), // reply
            relayEvent('3'.repeat(64), 9735, MYEVENT, 100), // zap
          ]),
        }),
      ],
    });

    const result = await layer.getNotifications({ viewerPubkey: ME, ownEventIds: [MYEVENT] });
    expect(result.isOk()).toBe(true);
    const out = result._unsafeUnwrap();
    expect(out.tier).toBe('relay');
    expect(out.grouped).toBe(false);
    expect(out.notifications.map((n) => n.reason)).toEqual(['reaction', 'reply', 'zap']); // newest-first
    // each carries the target event id (from #e) so the client groups them like nagg
    expect(out.notifications.every((n) => n['targetEventId'] === MYEVENT)).toBe(true);
  });

  test('fail-closed: an engagement referencing an event I do NOT own is dropped', async () => {
    const tier = createRelayTier({
      connection: fakeRelay([
        relayEvent('1'.repeat(64), 7, MYEVENT, 300), // references mine → keep
        relayEvent('4'.repeat(64), 7, OTHER, 400), // references someone else's → drop
      ]),
    });

    const outcome = await tier.notifications!({ viewerPubkey: ME, ownEventIds: [MYEVENT] });
    expect(outcome.kind).toBe('answered');
    if (outcome.kind === 'answered') {
      const ids = [...outcome.value.itemsById.keys()];
      expect(ids).toEqual(['1'.repeat(64)]);
    }
  });

  test('MENTIONS keeps replies + quotes + @-mentions, drops reactions/zaps/reposts', async () => {
    const reply: RawRelayEvent = {
      id: '1'.repeat(64), pubkey: ACTOR, kind: 1, tags: [['e', MYEVENT, '', 'reply'], ['p', ME]], created_at: 400,
    };
    const quote: RawRelayEvent = {
      id: '2'.repeat(64), pubkey: ACTOR, kind: 1, tags: [['q', MYEVENT]], created_at: 300,
    };
    const mention: RawRelayEvent = {
      id: '3'.repeat(64), pubkey: ACTOR, kind: 1, tags: [['p', ME]], created_at: 200,
    };
    const reaction: RawRelayEvent = {
      id: '4'.repeat(64), pubkey: ACTOR, kind: 7, tags: [['e', MYEVENT], ['p', ME]], created_at: 100,
    };
    const tier = createRelayTier({ connection: fakeRelay([reply, quote, mention, reaction]) });

    const mentions = await tier.notifications!({ viewerPubkey: ME, ownEventIds: [MYEVENT], tab: 'MENTIONS' });
    expect(mentions.kind).toBe('answered');
    if (mentions.kind === 'answered') {
      const reasons = [...mentions.value.itemsById.values()].map((n) => n.reason);
      expect(new Set(reasons)).toEqual(new Set(['reply', 'quote', 'mention']));
      expect(reasons).not.toContain('reaction');
    }
    // ALL keeps the reaction too.
    const all = await tier.notifications!({ viewerPubkey: ME, ownEventIds: [MYEVENT], tab: 'ALL' });
    if (all.kind === 'answered') {
      expect([...all.value.itemsById.values()].map((n) => n.reason)).toContain('reaction');
    }
  });

  test('replyScope DIRECT keeps only replies whose immediate parent is mine', async () => {
    const directReply: RawRelayEvent = {
      id: '6'.repeat(64), pubkey: ACTOR, kind: 1, tags: [['e', MYEVENT, '', 'reply'], ['p', ME]], created_at: 200,
    };
    const threadReply: RawRelayEvent = {
      id: '5'.repeat(64), pubkey: ACTOR, kind: 1,
      tags: [['e', MYEVENT, '', 'root'], ['e', OTHER, '', 'reply'], ['p', ME]], created_at: 100,
    };
    const tier = createRelayTier({ connection: fakeRelay([directReply, threadReply]) });

    const direct = await tier.notifications!({
      viewerPubkey: ME, ownEventIds: [MYEVENT], tab: 'MENTIONS', replyScope: 'DIRECT',
    });
    if (direct.kind === 'answered') {
      expect([...direct.value.itemsById.keys()]).toEqual(['6'.repeat(64)]); // thread reply dropped
    }
    const thread = await tier.notifications!({
      viewerPubkey: ME, ownEventIds: [MYEVENT], tab: 'MENTIONS', replyScope: 'THREAD',
    });
    if (thread.kind === 'answered') {
      expect([...thread.value.itemsById.keys()].sort()).toEqual(['5'.repeat(64), '6'.repeat(64)]);
    }
  });

  // Bug 3 (Stage-F): the #e backstop filter must page with the same until as the
  // primary filter, or every page re-fetches the full backstop set from newest.
  test('the #e backstop filter carries the cursor until', async () => {
    let captured: Array<Record<string, unknown>> | undefined;
    const connection: RelayConnection = {
      request: (filters): Promise<Result<RawRelayEvent[], NaggError>> => {
        captured = filters as unknown as Array<Record<string, unknown>>;
        return Promise.resolve(ok([]));
      },
    };
    const tier = createRelayTier({ connection });
    await tier.notifications!({ viewerPubkey: ME, ownEventIds: [MYEVENT], cursor: { createdAt: 500, id: 'a'.repeat(64) } });
    expect(captured?.[0]?.until).toBe(500); // primary
    expect(captured?.[1]?.['#e']).toEqual([MYEVENT]); // backstop
    expect(captured?.[1]?.until).toBe(500); // backstop now paged (was missing)
  });
});
