import { describe, expect, it } from 'vitest';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { createPrimalTier } from '../src/facade/primal/tier';
import type { PrimalCacheRequest, PrimalConnection, RawPrimalEvent } from '../src/facade/primal/protocol';
import { createRelayTier } from '../src/facade/relay/tier';
import type { NostrFilter, RawRelayEvent, RelayConnection } from '../src/facade/relay/protocol';
import type { NaggError } from '../src/errors';

const ME = 'f'.repeat(64);
const ACTOR = '1'.repeat(64);
const MYPOST = 'a'.repeat(64);

function primalNotification(content: Record<string, unknown>): RawPrimalEvent {
  return { kind: 10_000_132, content: JSON.stringify(content) };
}

function primalConnection(events: RawPrimalEvent[]): PrimalConnection & { captured: PrimalCacheRequest[] } {
  const captured: PrimalCacheRequest[] = [];
  return {
    captured,
    request: (request): Promise<Result<RawPrimalEvent[], NaggError>> => {
      captured.push(request);
      return Promise.resolve(ok(events));
    },
  };
}

describe('primal notifications tier', () => {
  it('sends get_notifications with pubkey/user_pubkey/limit/until', async () => {
    const connection = primalConnection([]);
    const tier = createPrimalTier({ connection });
    await tier.notifications!({ viewerPubkey: ME, limit: 25, cursor: { createdAt: 500, id: '' } });
    expect(connection.captured[0]?.verb).toBe('get_notifications');
    expect(connection.captured[0]?.params).toMatchObject({
      pubkey: ME,
      user_pubkey: ME,
      limit: 25,
      until: 500,
    });
  });

  it('demuxes summaries into flat items with type unset', async () => {
    const connection = primalConnection([
      primalNotification({ pubkey: ME, created_at: 100, type: 4, who_liked_it: ACTOR, your_post: MYPOST }),
      primalNotification({ pubkey: ME, created_at: 90, type: 1, follower: ACTOR }),
    ]);
    const tier = createPrimalTier({ connection });
    const outcome = await tier.notifications!({ viewerPubkey: ME });
    expect(outcome.kind).toBe('answered');
    if (outcome.kind !== 'answered') return;
    const items = [...outcome.value.itemsById.values()];
    expect(items).toHaveLength(2);
    expect(items[0]?.type).toBeUndefined();
    expect(items[0]?.reason).toBe('reaction');
    expect(items[0]?.targetEventId).toBe(MYPOST);
    expect(items[1]?.reason).toBe('follow');
    expect(outcome.value.grouped).toBe(false);
  });

  it('maps a zero-summary batch to unsupported (verb absent or shape drift)', async () => {
    const tier = createPrimalTier({ connection: primalConnection([{ kind: 1, id: 'x'.repeat(64), pubkey: ACTOR, content: 'hi', created_at: 5, tags: [] }]) });
    const outcome = await tier.notifications!({ viewerPubkey: ME });
    expect(outcome.kind).toBe('unsupported');
  });

  it('skips malformed summaries and other viewers, filters MENTIONS + DIRECT replies', async () => {
    const connection = primalConnection([
      primalNotification({ pubkey: ME, created_at: 100, type: 4, who_liked_it: ACTOR }), // engagement → dropped on MENTIONS
      primalNotification({ pubkey: ME, created_at: 99, type: 6, who_replied_to_it: ACTOR }), // reply → dropped on DIRECT
      primalNotification({ pubkey: ME, created_at: 98, type: 7 }), // mention (actor = pubkey fallback = viewer) → dropped as self
      primalNotification({ pubkey: ACTOR, created_at: 97, type: 4, who_liked_it: ACTOR }), // other viewer → dropped
      primalNotification({ created_at: 96, type: 4 }), // malformed (no pubkey) → skipped
      primalNotification({ pubkey: ME, created_at: 95, type: 8 }), // quote, actor fallback = ME → dropped as self
    ]);
    const tier = createPrimalTier({ connection });
    const outcome = await tier.notifications!({ viewerPubkey: ME, tab: 'MENTIONS', replyScope: 'DIRECT' });
    // Everything filtered → summaries existed, so it's an ANSWER with zero items,
    // not unsupported (the verb clearly works).
    expect(outcome.kind).toBe('answered');
    if (outcome.kind !== 'answered') return;
    expect(outcome.value.itemsById.size).toBe(0);
  });
});

describe('relay notificationsLiveSubscribe', () => {
  function liveConnection(): RelayConnection & {
    captured: NostrFilter[][];
    emit: (event: RawRelayEvent) => void;
    closed: number;
  } {
    const captured: NostrFilter[][] = [];
    let handler: ((event: RawRelayEvent) => void) | null = null;
    const api = {
      captured,
      closed: 0,
      emit: (event: RawRelayEvent) => handler?.(event),
      request: (): Promise<Result<RawRelayEvent[], NaggError>> => Promise.resolve(ok([])),
      subscribe: (filters: NostrFilter[], onEvent: (event: RawRelayEvent) => void) => {
        captured.push(filters);
        handler = onEvent;
        return () => {
          api.closed += 1;
        };
      },
    };
    return api;
  }

  it('opens kinds/#p (+#e/#q backstop) filters with since and NO limit', () => {
    const connection = liveConnection();
    const tier = createRelayTier({ connection });
    const unsubscribe = tier.notificationsLiveSubscribe!(
      { viewerPubkey: ME, tab: 'ALL', ownEventIds: [MYPOST] },
      { createdAt: 900, id: 'cursor' },
      () => {},
    );
    const filters = connection.captured[0]!;
    expect(filters[0]).toMatchObject({ kinds: [1, 6, 7, 9735], '#p': [ME], since: 900 });
    expect(filters[0]?.limit).toBeUndefined();
    expect(filters[1]).toMatchObject({ kinds: [1], '#e': [MYPOST], since: 900 });
    expect(filters[2]).toMatchObject({ kinds: [1], '#q': [MYPOST], since: 900 });
    unsubscribe();
    expect(connection.closed).toBe(1);
  });

  it('classifies live events (self events dropped, reactions delivered)', () => {
    const connection = liveConnection();
    const tier = createRelayTier({ connection });
    const received: string[] = [];
    tier.notificationsLiveSubscribe!({ viewerPubkey: ME, tab: 'ALL' }, undefined, (items) => {
      received.push(...items.map((i) => `${i.reason}:${i.event.id}`));
    });
    connection.emit({ id: 'like1', pubkey: ACTOR, kind: 7, tags: [['e', MYPOST], ['p', ME]], created_at: 10, content: '+' });
    connection.emit({ id: 'mine', pubkey: ME, kind: 1, tags: [['p', ME]], created_at: 11, content: 'self' });
    expect(received).toEqual(['reaction:like1']);
  });
});
