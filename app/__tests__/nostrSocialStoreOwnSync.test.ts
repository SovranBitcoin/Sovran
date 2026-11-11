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
      status: 'seeded',
      updatedAt: T,
    });
    useNostrSocialStore.getState().setContactsFromRelay({
      tags: [
        ['p', X],
        ['t', 'a'],
      ],
      content: 'c',
      createdAtSec: T,
    });
    expect(selectContactList(useNostrSocialStore.getState())).toEqual({
      status: 'authoritative',
      tags: [
        ['p', X],
        ['t', 'a'],
      ],
      content: 'c',
      updatedAt: T,
    });
    // A newer seed with fewer follows: the saved tags are no longer the list.
    useNostrSocialStore.getState().seedFollowsFromFacade({ follows: [], createdAtSec: T + 1 });
    expect(selectContactList(useNostrSocialStore.getState())).toEqual({
      status: 'seeded',
      updatedAt: T + 1,
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
