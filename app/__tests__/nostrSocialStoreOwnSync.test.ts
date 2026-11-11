/**
 * Unit tests for nostrSocialStore's own-events ingest path (used by
 * useOwnEventsSync): global upsert of likes/reposts/replies, kind:5 deletions,
 * the replied index, and the follow list's states decoded from the saved fields.
 */
import {
  selectContactList,
  selectFollowIntents,
  useNostrSocialStore,
} from '@/shared/stores/profile/nostrSocialStore';

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (e: unknown) => e,
}));

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

beforeEach(() => {
  useNostrSocialStore.setState({ engagementByEventId: {} });
});

describe('nostrSocialStore own-events ingest', () => {
  it('upserts likes by target, newest createdAtSec wins, no scoped delete', () => {
    const s = useNostrSocialStore.getState();
    s.ingestOwnLikes([
      { targetEventId: 't1', reactionEventId: 'r1', createdAtSec: 100 },
      { targetEventId: 't2', reactionEventId: 'r2', createdAtSec: 100 },
    ]);
    // A second batch that omits t2 must NOT delete it (unlike the old scoped sync).
    s.ingestOwnLikes([{ targetEventId: 't1', reactionEventId: 'r1b', createdAtSec: 200 }]);

    const { engagementByEventId } = useNostrSocialStore.getState();
    expect(engagementByEventId.t1.liked?.ownEventId).toBe('r1b'); // newer wins
    expect(engagementByEventId.t2.liked?.ownEventId).toBe('r2'); // preserved
  });

  it('merges multiple action types into ONE record per target (no +3 maps)', () => {
    const s = useNostrSocialStore.getState();
    s.ingestOwnLikes([{ targetEventId: 't1', reactionEventId: 'like1', createdAtSec: 100 }]);
    s.ingestOwnReposts([{ targetEventId: 't1', repostEventId: 'repost1', createdAtSec: 200 }]);

    const record = useNostrSocialStore.getState().engagementByEventId.t1;
    expect(record.liked?.ownEventId).toBe('like1');
    expect(record.reposted?.ownEventId).toBe('repost1');
    expect(record.updatedAt).toBe(200); // newest contributing action
  });

  it('populates the replied field for the "you replied" highlight', () => {
    useNostrSocialStore
      .getState()
      .ingestOwnReplies([{ targetEventId: 'parent1', replyEventId: 'reply1', createdAtSec: 100 }]);
    expect(useNostrSocialStore.getState().engagementByEventId.parent1.replied?.ownEventId).toBe(
      'reply1'
    );
  });

  it('applies kind:5 deletions by own event id, clearing only the deleted action', () => {
    const s = useNostrSocialStore.getState();
    // t1 has BOTH a like (to delete) and a repost (to keep) — the record survives.
    s.ingestOwnLikes([{ targetEventId: 't1', reactionEventId: 'like-del', createdAtSec: 100 }]);
    s.ingestOwnReposts([{ targetEventId: 't1', repostEventId: 'repost-keep', createdAtSec: 100 }]);
    s.ingestOwnReplies([{ targetEventId: 't3', replyEventId: 'reply-del', createdAtSec: 100 }]);

    s.applyOwnDeletions(['like-del', 'reply-del']);

    const next = useNostrSocialStore.getState();
    expect(next.engagementByEventId.t1.liked).toBeUndefined(); // like deleted → un-highlight
    expect(next.engagementByEventId.t1.reposted?.ownEventId).toBe('repost-keep'); // sibling kept
    expect(next.engagementByEventId.t3).toBeUndefined(); // last action gone → record dropped
  });
});

describe('nostrSocialStore follow list', () => {
  const X = 'b1'.repeat(32);
  const T = 1_700_000_000;

  beforeEach(() => {
    useNostrSocialStore.setState(useNostrSocialStore.getInitialState(), true);
  });

  it('decodes the saved fields', () => {
    expect(selectContactList(useNostrSocialStore.getState())).toEqual({ status: 'unknown' });
    useNostrSocialStore.getState().seedFollowsFromFacade({ follows: [X], createdAtSec: T });
    expect(selectContactList(useNostrSocialStore.getState())).toEqual({
      status: 'known',
      updatedAt: T,
    });
    useNostrSocialStore.getState().setContactsFromRelay({
      tags: [
        ['p', X],
        ['t', 'a'],
      ],
      content: 'c',
      createdAtSec: T,
      eventId: 'e1',
    });
    expect(selectContactList(useNostrSocialStore.getState())).toEqual({
      status: 'known',
      updatedAt: T,
      eventId: 'e1',
    });
    // A newer seed, also one with no follows, moves the stamp on.
    useNostrSocialStore.getState().seedFollowsFromFacade({ follows: [], createdAtSec: T + 1 });
    expect(selectContactList(useNostrSocialStore.getState())).toEqual({
      status: 'known',
      updatedAt: T + 1,
    });
  });

  it('keeps the lower id of two lists from the same second, in whichever order they arrive', () => {
    const social = () => useNostrSocialStore.getState();
    const low = { tags: [['p', X]], content: 'low', createdAtSec: T, eventId: '1'.repeat(64) };
    const high = { tags: [], content: 'high', createdAtSec: T, eventId: '9'.repeat(64) };

    social().setContactsFromRelay(low);
    social().setContactsFromRelay(high);
    expect(social()).toMatchObject({ contactsContent: 'low', followingPubkeys: { [X]: true } });

    useNostrSocialStore.setState(useNostrSocialStore.getInitialState(), true);
    social().setContactsFromRelay(high);
    social().setContactsFromRelay(low);
    expect(social()).toMatchObject({ contactsContent: 'low', followingPubkeys: { [X]: true } });
    expect(selectContactList(social())).toEqual({
      status: 'known',
      updatedAt: T,
      eventId: low.eventId,
    });
  });

  it('takes, of lists from the second of one saved without its id, only that list itself; a newer one replaces it', () => {
    const social = () => useNostrSocialStore.getState();
    // As loaded from storage: the saved fields, no id.
    useNostrSocialStore.setState({
      contactsTags: [['p', X]],
      contactsContent: 'saved',
      contactsUpdatedAt: T,
      followingPubkeys: { [X]: true },
    });
    social().setContactsFromRelay({
      tags: [],
      content: 'other',
      createdAtSec: T,
      eventId: '1'.repeat(64),
    });
    expect(social()).toMatchObject({ contactsContent: 'saved', followingPubkeys: { [X]: true } });
    expect(selectContactList(social())).toEqual({ status: 'known', updatedAt: T });

    social().setContactsFromRelay({
      tags: [['p', X]],
      content: 'saved',
      createdAtSec: T,
      eventId: '9'.repeat(64),
    });
    expect(selectContactList(social())).toEqual({
      status: 'known',
      updatedAt: T,
      eventId: '9'.repeat(64),
    });

    social().setContactsFromRelay({
      tags: [],
      content: 'newer',
      createdAtSec: T + 1,
      eventId: 'e2',
    });
    expect(social()).toMatchObject({ contactsContent: 'newer', followingPubkeys: {} });
  });

  it('counts a list that was loaded empty, or follows saved without a stamp, as known', () => {
    useNostrSocialStore
      .getState()
      .setContactsFromRelay({ tags: [], content: '', createdAtSec: T, eventId: 'e1' });
    expect(selectContactList(useNostrSocialStore.getState())).toEqual({
      status: 'known',
      updatedAt: T,
      eventId: 'e1',
    });
    useNostrSocialStore.setState(useNostrSocialStore.getInitialState(), true);
    useNostrSocialStore.setState({ followingPubkeys: { [X]: true } });
    expect(selectContactList(useNostrSocialStore.getState())).toEqual({
      status: 'known',
      updatedAt: 0,
    });
  });

  it('reads a pending entry, also one saved before a restart, as an outstanding intent', () => {
    useNostrSocialStore.setState({
      optimisticFollowsByPubkey: {
        [X]: { value: false, pending: true, updatedAt: 3 },
        settled: { value: true, pending: false, updatedAt: 4 },
      },
    });
    expect(selectFollowIntents(useNostrSocialStore.getState())).toEqual({
      [X]: { value: false, pending: true, updatedAt: 3 },
    });
  });

  it('settles an intent only if no newer tap replaced it', () => {
    const s = useNostrSocialStore.getState();
    s.setFollowIntent(X, true);
    const applied = selectFollowIntents(useNostrSocialStore.getState());
    s.setFollowIntent('other', true);
    s.settleFollowIntents(applied);
    expect(Object.keys(useNostrSocialStore.getState().optimisticFollowsByPubkey)).toEqual([
      'other',
    ]);

    const stale = { [X]: { value: false, pending: true, updatedAt: 1 } };
    s.setFollowIntent(X, true);
    s.settleFollowIntents(stale);
    expect(useNostrSocialStore.getState().optimisticFollowsByPubkey[X]).toMatchObject({
      value: true,
      pending: true,
    });
  });
});
