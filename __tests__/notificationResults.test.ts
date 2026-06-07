import type { FeedNotification, FeedNotificationsResult } from '@/features/feed/data/feedClient';
import {
  filterNotificationsResult,
  mergeNotificationsResult,
} from '@/features/feed/lib/notificationResults';

const event = (id: string, pubkey = `${id}-pubkey`) => ({
  id,
  pubkey,
  kind: 1,
  content: id,
  tags: [],
  created_at: 10,
});

const notification = (id: string, reason: string): FeedNotification => ({
  event: event(id),
  reason,
  actorVertexScore: 0,
});

const result = (
  notifications: FeedNotification[],
  paginationUntil: number
): FeedNotificationsResult => ({
  notifications,
  paginationUntil,
  hasNextPage: paginationUntil > 0,
  profilesMap: new Map(notifications.map((item) => [item.event.pubkey, { name: item.event.id }])),
  metricsMap: new Map(),
  quotedEventsMap: new Map(),
});

describe('notification results', () => {
  it('filters notifications while preserving page metadata', () => {
    const page = result([notification('follow-1', 'follow'), notification('reply-1', 'reply')], 5);

    expect(filterNotificationsResult(page, (item) => item.reason === 'follow')).toMatchObject({
      notifications: [expect.objectContaining({ reason: 'follow' })],
      paginationUntil: 5,
    });
  });

  it('merges pages without duplicating notification event ids', () => {
    const merged = mergeNotificationsResult(
      result([notification('a', 'follow'), notification('b', 'reply')], 8),
      result([notification('b', 'reply'), notification('c', 'follow')], 4)
    );

    expect(merged.notifications.map((item) => item.event.id)).toEqual(['a', 'b', 'c']);
    expect(merged.paginationUntil).toBe(4);
    expect(merged.profilesMap.get('c-pubkey')).toEqual({ name: 'c' });
  });
});
