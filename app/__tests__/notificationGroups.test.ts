import { buildNotificationListItems } from '@/features/feed/lib/notificationGroups';
import type { FeedNotification } from '@/features/feed/data/feedClient';

const event = (id: string, pubkey: string, kind = 1) => ({
  id,
  pubkey,
  kind,
  content: '',
  tags: [],
  created_at: 1,
});

const notification = (id: string, reason: string, targetEventId?: string): FeedNotification => ({
  event: event(id, `${id}-pubkey`),
  ...(targetEventId
    ? {
        targetEvent: event(targetEventId, `${targetEventId}-pubkey`),
        targetEventId,
      }
    : {}),
  reason,
  actorVertexScore: 0,
});

describe('buildNotificationListItems', () => {
  it('groups follows and same-target reposts across the whole page (not just contiguous)', () => {
    const items = buildNotificationListItems([
      notification('follow-1', 'follow'),
      notification('follow-2', 'follow'),
      notification('reply-1', 'reply'),
      notification('follow-3', 'follow'), // not contiguous with the others — still groups
      notification('repost-1', 'repost', 'post-1'),
      notification('repost-2', 'repost', 'post-1'),
      notification('zap-1', 'zap'), // lone batchable → demoted to single
      notification('quote-1', 'quote'),
    ]);

    expect(items).toEqual([
      // Anchored at follow-1's position; follow-3 merges up despite reply-1 between.
      expect.objectContaining({
        type: 'group',
        reason: 'follow',
        total: 3,
        notifications: [
          expect.objectContaining({ event: expect.objectContaining({ id: 'follow-1' }) }),
          expect.objectContaining({ event: expect.objectContaining({ id: 'follow-2' }) }),
          expect.objectContaining({ event: expect.objectContaining({ id: 'follow-3' }) }),
        ],
      }),
      expect.objectContaining({
        type: 'single',
        notification: expect.objectContaining({ reason: 'reply' }),
      }),
      expect.objectContaining({ type: 'group', reason: 'repost', total: 2 }),
      expect.objectContaining({
        type: 'single',
        notification: expect.objectContaining({ reason: 'zap' }),
      }),
      expect.objectContaining({
        type: 'single',
        notification: expect.objectContaining({ reason: 'quote' }),
      }),
    ]);
  });

  it('keeps adjacent reposts for different target posts distinct', () => {
    const items = buildNotificationListItems([
      notification('repost-1', 'repost', 'post-1'),
      notification('repost-2', 'repost', 'post-2'),
      notification('repost-3', 'repost', 'post-2'),
    ]);

    expect(items).toEqual([
      expect.objectContaining({
        type: 'single',
        notification: expect.objectContaining({ targetEventId: 'post-1' }),
      }),
      expect.objectContaining({
        type: 'group',
        reason: 'repost',
        notifications: [
          expect.objectContaining({ targetEventId: 'post-2' }),
          expect.objectContaining({ targetEventId: 'post-2' }),
        ],
      }),
    ]);
  });
});

describe('row id stability (unified session no-shift contract)', () => {
  it('keeps a server group id stable across total changes', () => {
    const grouped = (total: number): FeedNotification => ({
      ...notification('rep-1', 'reaction', 'post-1'),
      type: 'group',
      total,
      sampleActors: [{ pubkey: 'rep-1-pubkey', eventId: 'rep-1', createdAt: 1 }],
    });
    const [three] = buildNotificationListItems([grouped(3)]);
    const [five] = buildNotificationListItems([grouped(5)]);
    expect(three?.id).toBe(five?.id);
    expect(three?.id).toContain('post-1'); // target-keyed, not representative-keyed
  });

  it('keeps the id stable when a client single grows into a group', () => {
    const [single] = buildNotificationListItems([notification('like-1', 'reaction', 'post-9')]);
    const [group] = buildNotificationListItems([
      notification('like-1', 'reaction', 'post-9'),
      notification('like-2', 'reaction', 'post-9'),
    ]);
    expect(single?.type).toBe('single');
    expect(group?.type).toBe('group');
    expect(single?.id).toBe(group?.id);
  });

  it('keeps server and client group ids in the same id space for one target', () => {
    const [client] = buildNotificationListItems([
      notification('like-1', 'reaction', 'post-2'),
      notification('like-2', 'reaction', 'post-2'),
    ]);
    const [server] = buildNotificationListItems([
      {
        ...notification('like-9', 'reaction', 'post-2'),
        type: 'group',
        total: 4,
        sampleActors: [{ pubkey: 'a', eventId: 'like-9', createdAt: 1 }],
      },
    ]);
    expect(client?.id).toBe(server?.id);
  });
});
