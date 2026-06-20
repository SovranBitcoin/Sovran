/**
 * Unit tests for nostrSocialStore's own-events ingest path (used by
 * useOwnEventsSync): global upsert of likes/reposts/replies, kind:5 deletions,
 * and the replied index.
 */
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';

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
  useNostrSocialStore.setState({
    likesByEventId: {},
    repostsByEventId: {},
    repliedByEventId: {},
  });
});

describe('nostrSocialStore own-events ingest', () => {
  it('upserts likes by target, newest createdAt wins, no scoped delete', () => {
    const s = useNostrSocialStore.getState();
    s.ingestOwnLikes([
      { targetEventId: 't1', reactionEventId: 'r1', createdAt: 100 },
      { targetEventId: 't2', reactionEventId: 'r2', createdAt: 100 },
    ]);
    // A second batch that omits t2 must NOT delete it (unlike the old scoped sync).
    s.ingestOwnLikes([{ targetEventId: 't1', reactionEventId: 'r1b', createdAt: 200 }]);

    const { likesByEventId } = useNostrSocialStore.getState();
    expect(likesByEventId.t1.reactionEventId).toBe('r1b'); // newer wins
    expect(likesByEventId.t2.reactionEventId).toBe('r2'); // preserved
  });

  it('populates the replied index for the "you replied" highlight', () => {
    useNostrSocialStore
      .getState()
      .ingestOwnReplies([{ targetEventId: 'parent1', replyEventId: 'reply1', createdAt: 100 }]);
    expect(useNostrSocialStore.getState().repliedByEventId.parent1.replyEventId).toBe('reply1');
  });

  it('applies kind:5 deletions by own event id across likes/reposts/replies', () => {
    const s = useNostrSocialStore.getState();
    s.ingestOwnLikes([{ targetEventId: 't1', reactionEventId: 'like-del', createdAt: 100 }]);
    s.ingestOwnReposts([{ targetEventId: 't2', repostEventId: 'repost-keep', createdAt: 100 }]);
    s.ingestOwnReplies([{ targetEventId: 't3', replyEventId: 'reply-del', createdAt: 100 }]);

    s.applyOwnDeletions(['like-del', 'reply-del']);

    const next = useNostrSocialStore.getState();
    expect(next.likesByEventId.t1).toBeUndefined(); // like deleted → un-highlight
    expect(next.repliedByEventId.t3).toBeUndefined(); // reply deleted
    expect(next.repostsByEventId.t2?.repostEventId).toBe('repost-keep'); // untouched
  });
});
