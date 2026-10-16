import type { FeedNotification } from '@/features/feed/data/feedClient';
import {
  buildNotificationListItems,
  notificationListItemsEqual,
} from '@/features/feed/lib/notificationGroups';
import { countFollowing } from '@/features/feed/lib/feedEmptyStates';

const event = (id: string, pubkey = `${id}-pubkey`) => ({
  id,
  pubkey,
  kind: 1,
  content: '',
  tags: [],
  created_at: 1,
});

const single = (id: string, over: Partial<FeedNotification> = {}): FeedNotification => ({
  type: 'single',
  event: event(id),
  reason: 'reply',
  actorVertexScore: 0,
  ...over,
});

const serverGroup = (total: number, actorIds: string[] = ['a1', 'a2']): FeedNotification => ({
  type: 'group',
  event: event('rep'),
  reason: 'reaction',
  actorVertexScore: 0,
  total,
  targetEventId: 'post-1',
  sampleActors: actorIds.map((actorId) => ({
    pubkey: `${actorId}-pubkey`,
    eventId: actorId,
    createdAt: 1,
  })),
});

/** The list rebuilds every item on every page update; these are two such builds. */
const built = (notifications: FeedNotification[]) => buildNotificationListItems(notifications);

describe('notificationListItemsEqual', () => {
  it('treats two builds of the same page as the same rows', () => {
    const page = () => [single('reply-1'), serverGroup(12), single('quote-1', { reason: 'quote' })];
    const before = built(page());
    const after = built(page());

    expect(after).toHaveLength(before.length);
    after.forEach((item, index) => {
      expect(item).not.toBe(before[index]);
      expect(notificationListItemsEqual(before[index]!, item)).toBe(true);
    });
  });

  it('sees a group whose count moved', () => {
    const [before] = built([serverGroup(12)]);
    const [after] = built([serverGroup(13)]);
    expect(before!.id).toBe(after!.id);
    expect(notificationListItemsEqual(before!, after!)).toBe(false);
  });

  it('sees a group whose sampled members changed', () => {
    const [before] = built([serverGroup(12, ['a1', 'a2'])]);
    const [after] = built([serverGroup(12, ['a1', 'a3'])]);
    expect(notificationListItemsEqual(before!, after!)).toBe(false);
  });

  it('sees a notification that gained its target post', () => {
    const [before] = built([single('like-1', { reason: 'mention', targetEventId: 'post-1' })]);
    const [after] = built([
      single('like-1', {
        reason: 'mention',
        targetEventId: 'post-1',
        targetEvent: event('post-1'),
      }),
    ]);
    expect(notificationListItemsEqual(before!, after!)).toBe(false);
  });

  it('sees a client group that became a single row under the same id', () => {
    const like = (id: string): FeedNotification => ({
      event: event(id),
      reason: 'reaction',
      actorVertexScore: 0,
      targetEventId: 'post-1',
    });
    const [group] = built([like('l1'), like('l2')]);
    const [demoted] = built([like('l1')]);
    expect(group!.id).toBe(demoted!.id);
    expect(notificationListItemsEqual(group!, demoted!)).toBe(false);
  });

  it('never equates two different rows', () => {
    const [a, b] = built([single('reply-1'), single('reply-2')]);
    expect(notificationListItemsEqual(a!, b!)).toBe(false);
  });

  it('compares the app rows by what they show', () => {
    const welcome = { type: 'welcome', id: 'welcome', installDate: 1, termsDate: 'x' } as const;
    expect(notificationListItemsEqual(welcome, { ...welcome })).toBe(true);
    expect(notificationListItemsEqual(welcome, { ...welcome, termsDate: 'y' })).toBe(false);

    const legal = {
      type: 'legal',
      id: 'legal-acceptance',
      acceptedAtMs: 1,
      termsRevisionShort: 'abc',
      privacyRevisionShort: 'def',
      isCurrent: true,
      revisionKnown: true,
    } as const;
    expect(notificationListItemsEqual(legal, { ...legal })).toBe(true);
    expect(notificationListItemsEqual(legal, { ...legal, isCurrent: false })).toBe(false);
  });
});

describe('countFollowing', () => {
  it('counts the accounts in a following map', () => {
    expect(countFollowing({})).toBe(0);
    expect(countFollowing({ a: true, b: true, c: true })).toBe(3);
  });
});
