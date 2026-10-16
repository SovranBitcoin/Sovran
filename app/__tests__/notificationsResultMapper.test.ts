import type { facade } from 'nostr';

import {
  createNotificationsResultMapper,
  resolvedNotificationsToResult,
} from '@/features/feed/data/facadeNotificationsAdapter';

const PUB = 'c'.repeat(64);
const id = (char: string) => char.repeat(64);

function event(eventId: string, created_at: number) {
  return { id: eventId, kind: 1, pubkey: PUB, content: `e ${eventId}`, tags: [], created_at };
}

type Page = facade.ResolvedNotifications;
type PageNotification = Page['notifications'][number];

const reply = (char: string, createdAt: number): PageNotification => ({
  type: 'single',
  event: event(id(char), createdAt),
  reason: 'reply',
  actorVertexScore: 0,
});

const likes = (char: string, total: number): PageNotification => ({
  type: 'group',
  event: event(id(char), 200),
  reason: 'reaction',
  actorVertexScore: 0,
  total,
  totalCapped: false,
  sampleActors: [{ pubkey: PUB, eventId: id('f'), createdAt: 200 }],
  targetEventId: id(char),
});

/** A page built from scratch each call, the way a session snapshot is. */
function page(notifications: PageNotification[], over: Partial<Page> = {}): Page {
  return {
    tier: 'nagg',
    grouped: true,
    notifications,
    stats: { [id('a')]: { likes: 3, reposts: 0, replies: 1, zaps: 0, satsZapped: 0 } },
    profiles: { [PUB]: { name: 'alice', picture: 'https://example.com/a.png' } },
    quoted: { [id('e')]: event(id('e'), 90) },
    cursor: { createdAt: 100, id: id('b') },
    missingIds: [],
    ...over,
  };
}

describe('createNotificationsResultMapper', () => {
  it('returns exactly what the plain adapter returns, on every snapshot', () => {
    const map = createNotificationsResultMapper();
    const snapshots = [
      page([likes('a', 3), reply('b', 100)]),
      page([reply('d', 300), likes('a', 4), reply('b', 100)]),
      page([likes('a', 4)], { profiles: {}, cursor: null }),
      page([]),
    ];

    for (const snapshot of snapshots) {
      expect(map(snapshot)).toEqual(resolvedNotificationsToResult(snapshot));
    }
  });

  it('keeps the order of the newest snapshot', () => {
    const map = createNotificationsResultMapper();
    map(page([likes('a', 3), reply('b', 100)]));

    const next = map(page([reply('b', 100), reply('d', 300), likes('a', 3)]));

    expect(next.notifications.map((n) => n.event.id)).toEqual([id('b'), id('d'), id('a')]);
  });

  it('hands back the previous object for a notification that did not change', () => {
    const map = createNotificationsResultMapper();
    const first = map(page([likes('a', 3), reply('b', 100)]));

    const second = map(page([reply('d', 300), likes('a', 3), reply('b', 100)]));

    expect(second.notifications[1]).toBe(first.notifications[0]);
    expect(second.notifications[2]).toBe(first.notifications[1]);
  });

  it('gives a changed notification a new object carrying the new values', () => {
    const map = createNotificationsResultMapper();
    const first = map(page([likes('a', 3), reply('b', 100)]));

    const second = map(page([likes('a', 4), reply('b', 100)]));

    expect(second.notifications[0]).not.toBe(first.notifications[0]);
    expect(second.notifications[0]!.total).toBe(4);
    expect(second.notifications[1]).toBe(first.notifications[1]);
  });

  it('keeps an enrichment map only while every entry is the same', () => {
    const map = createNotificationsResultMapper();
    const first = map(page([reply('b', 100)]));

    const same = map(page([reply('b', 100), reply('d', 300)]));
    expect(same.profilesMap).toBe(first.profilesMap);
    expect(same.metricsMap).toBe(first.metricsMap);
    expect(same.quotedEventsMap).toBe(first.quotedEventsMap);

    const renamed = map(page([reply('b', 100)], { profiles: { [PUB]: { name: 'alice b' } } }));
    expect(renamed.profilesMap).not.toBe(first.profilesMap);
    expect(renamed.profilesMap.get(PUB)).toEqual({ name: 'alice b' });
    // The maps that did not change are still the originals.
    expect(renamed.metricsMap).toBe(first.metricsMap);

    const liked = map(
      page([reply('b', 100)], {
        profiles: { [PUB]: { name: 'alice b' } },
        stats: { [id('a')]: { likes: 4, reposts: 0, replies: 1, zaps: 0, satsZapped: 0 } },
      })
    );
    expect(liked.metricsMap.get(id('a'))?.likeCount).toBe(4);
    expect(liked.profilesMap).toBe(renamed.profilesMap);
  });

  it('does not share anything between two sessions', () => {
    const first = createNotificationsResultMapper()(page([reply('b', 100)]));
    const other = createNotificationsResultMapper()(page([reply('b', 100)]));

    expect(other.notifications[0]).not.toBe(first.notifications[0]);
    expect(other).toEqual(first);
  });
});
