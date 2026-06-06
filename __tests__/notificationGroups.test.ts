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
  it('batches only contiguous follows and reposts', () => {
    const items = buildNotificationListItems([
      notification('follow-1', 'follow'),
      notification('follow-2', 'follow'),
      notification('reply-1', 'reply'),
      notification('follow-3', 'follow'),
      notification('repost-1', 'repost', 'post-1'),
      notification('repost-2', 'repost', 'post-1'),
      notification('zap-1', 'zap'),
      notification('quote-1', 'quote'),
    ]);

    expect(items).toEqual([
      expect.objectContaining({ type: 'group', reason: 'follow' }),
      expect.objectContaining({
        type: 'single',
        notification: expect.objectContaining({ reason: 'reply' }),
      }),
      expect.objectContaining({
        type: 'single',
        notification: expect.objectContaining({
          event: expect.objectContaining({ id: 'follow-3' }),
        }),
      }),
      expect.objectContaining({ type: 'group', reason: 'repost' }),
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
