import { describe, expect, it } from 'vitest';
import {
  createNotificationsMerger,
  notificationMergeKey,
} from '../src/facade/session/notifications-merger';
import type { NotificationItem } from '../src/facade/notifications';
import type { NaggFeedEvent } from '../src/map/feed';

const TARGET = 'a'.repeat(64);
const OTHER_TARGET = 'b'.repeat(64);

function ev(id: string, pubkey: string, kind: number, created_at: number): NaggFeedEvent {
  return { id, pubkey, kind, content: '', tags: [], created_at };
}

function item(
  id: string,
  pubkey: string,
  reason: string,
  created_at: number,
  extra?: Partial<NotificationItem>,
): NotificationItem {
  const kind = reason === 'reaction' ? 7 : reason === 'zap' ? 9735 : reason === 'repost' ? 6 : 1;
  return {
    event: ev(id, pubkey, kind, created_at),
    reason,
    actorVertexScore: 0,
    targetEventId: TARGET,
    ...extra,
  };
}

describe('notificationMergeKey', () => {
  it('collapses groupable reasons on reason:target and follows on the constant', () => {
    expect(notificationMergeKey(item('e1', 'p1', 'reaction', 10))).toBe(`reaction:${TARGET}`);
    expect(notificationMergeKey(item('e2', 'p2', 'reaction', 11))).toBe(`reaction:${TARGET}`);
    expect(notificationMergeKey(item('e3', 'p3', 'follow', 12))).toBe('follow');
  });

  it('keeps two replies to the same post distinct (the event IS the row)', () => {
    expect(notificationMergeKey(item('r1', 'p1', 'reply', 10))).toBe('reply:r1');
    expect(notificationMergeKey(item('r2', 'p2', 'reply', 11))).toBe('reply:r2');
  });
});

describe('notifications merger', () => {
  it('merges cross-source evidence for one target into one group row', () => {
    const merger = createNotificationsMerger();
    merger.ingest('relay', [item('like1', 'alice', 'reaction', 10)]);
    merger.ingest('relay', [item('like2', 'bob', 'reaction', 11)]);
    merger.reveal(50);
    const [row] = merger.snapshot().notifications;
    expect(row?.type).toBe('group');
    expect(row?.total).toBe(2);
    expect(merger.revealedCount()).toBe(1);
  });

  it('dedupes the same evidence id across pages and re-polls (no double count)', () => {
    const merger = createNotificationsMerger();
    merger.ingest('relay', [item('like1', 'alice', 'reaction', 10)]);
    const second = merger.ingest('relay', [item('like1', 'alice', 'reaction', 10)]);
    expect(second.updated).toHaveLength(0);
    expect(second.created).toHaveLength(0);
  });

  it('counts by distinct actor pubkey: one actor, two reaction events → 1 person', () => {
    const merger = createNotificationsMerger();
    merger.ingest('relay', [
      item('like1', 'alice', 'reaction', 10),
      item('like2', 'alice', 'reaction', 11),
    ]);
    merger.reveal(50);
    const [row] = merger.snapshot().notifications;
    expect(row?.total ?? 1).toBeLessThanOrEqual(1);
  });

  it('counts zaps by evidence id with the relay service pubkey blanked', () => {
    const merger = createNotificationsMerger();
    merger.ingest('relay', [
      item('zap1', 'lnurl-service', 'zap', 10),
      item('zap2', 'lnurl-service', 'zap', 11),
    ]);
    merger.reveal(50);
    const [row] = merger.snapshot().notifications;
    expect(row?.total).toBe(2);
    // Blanked pubkeys must not surface as avatar sample actors.
    expect(row?.sampleActors ?? []).toHaveLength(0);
  });

  it('nagg owns row shape; relay evidence bumps beyond the nagg baseline', () => {
    const merger = createNotificationsMerger();
    merger.ingest('nagg', [
      item('rep', 'alice', 'reaction', 20, {
        type: 'group',
        total: 3,
        sampleActors: [
          { pubkey: 'alice', eventId: 'rep', createdAt: 20 },
          { pubkey: 'bob', eventId: 'like2', createdAt: 19 },
        ],
      }),
    ]);
    merger.reveal(50);
    let [row] = merger.snapshot().notifications;
    expect(row?.total).toBe(3);

    // Two NEW distinct actors from relay: distinct evidence (4) beats naggTotal.
    const result = merger.ingest('relay', [
      item('like3', 'carol', 'reaction', 21),
      item('like4', 'dave', 'reaction', 22),
    ]);
    expect(result.updated).toContain(`reaction:${TARGET}`);
    [row] = merger.snapshot().notifications;
    expect(row?.total).toBe(4);
    // nagg's sample actors stay (rank-owned shape).
    expect(row?.sampleActors?.[0]?.pubkey).toBe('alice');
  });

  it('late nagg upgrades a relay-shaped row in place without reordering', () => {
    const merger = createNotificationsMerger();
    merger.ingest('relay', [
      item('like1', 'alice', 'reaction', 10),
      item('post9', 'eve', 'reply', 30, { targetEventId: OTHER_TARGET }),
    ]);
    merger.reveal(50);
    const before = merger.snapshot().notifications.map((n) => notificationMergeKey(n));

    merger.ingest('nagg', [
      item('naggRep', 'alice', 'reaction', 25, {
        type: 'group',
        total: 6,
        totalCapped: true,
        sampleActors: [{ pubkey: 'alice', eventId: 'naggRep', createdAt: 25 }],
      }),
    ]);
    const after = merger.snapshot().notifications;
    expect(after.map((n) => notificationMergeKey(n))).toEqual(before); // frozen order
    const group = after.find((n) => n.reason === 'reaction');
    expect(group?.total).toBe(6);
    expect(group?.totalCapped).toBe(true);
    expect(group?.event.id).toBe('naggRep'); // representative upgraded in place
  });

  it('pools new keys until reveal and reports pooledCount', () => {
    const merger = createNotificationsMerger();
    merger.ingest('relay', [item('like1', 'alice', 'reaction', 10)]);
    merger.reveal(50);
    merger.ingest('relay', [item('rep1', 'bob', 'reply', 40)]);
    expect(merger.revealedCount()).toBe(1);
    expect(merger.pooledCount()).toBe(1);
    merger.reveal(50);
    expect(merger.revealedCount()).toBe(2);
    expect(merger.pooledCount()).toBe(0);
  });

  it('lower-rank sources only fill absent target fields', () => {
    const merger = createNotificationsMerger();
    merger.ingest('nagg', [item('rep', 'alice', 'reply', 20, { targetEventId: undefined })]);
    merger.ingest('relay', [
      { ...item('rep', 'alice', 'reply', 20), targetEventId: OTHER_TARGET },
    ]);
    merger.reveal(50);
    const [row] = merger.snapshot().notifications;
    expect(row?.targetEventId).toBe(OTHER_TARGET); // filled, not replaced
  });
});
