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
  useNostrSocialStore.setState({ engagementByEventId: {} });
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

    const { engagementByEventId } = useNostrSocialStore.getState();
    expect(engagementByEventId.t1.liked?.ownEventId).toBe('r1b'); // newer wins
    expect(engagementByEventId.t2.liked?.ownEventId).toBe('r2'); // preserved
  });

  it('merges multiple action types into ONE record per target (no +3 maps)', () => {
    const s = useNostrSocialStore.getState();
    s.ingestOwnLikes([{ targetEventId: 't1', reactionEventId: 'like1', createdAt: 100 }]);
    s.ingestOwnReposts([{ targetEventId: 't1', repostEventId: 'repost1', createdAt: 200 }]);

    const record = useNostrSocialStore.getState().engagementByEventId.t1;
    expect(record.liked?.ownEventId).toBe('like1');
    expect(record.reposted?.ownEventId).toBe('repost1');
    expect(record.updatedAt).toBe(200); // newest contributing action
  });

  it('populates the replied field for the "you replied" highlight', () => {
    useNostrSocialStore
      .getState()
      .ingestOwnReplies([{ targetEventId: 'parent1', replyEventId: 'reply1', createdAt: 100 }]);
    expect(useNostrSocialStore.getState().engagementByEventId.parent1.replied?.ownEventId).toBe(
      'reply1'
    );
  });

  it('applies kind:5 deletions by own event id, clearing only the deleted action', () => {
    const s = useNostrSocialStore.getState();
    // t1 has BOTH a like (to delete) and a repost (to keep) — the record survives.
    s.ingestOwnLikes([{ targetEventId: 't1', reactionEventId: 'like-del', createdAt: 100 }]);
    s.ingestOwnReposts([{ targetEventId: 't1', repostEventId: 'repost-keep', createdAt: 100 }]);
    s.ingestOwnReplies([{ targetEventId: 't3', replyEventId: 'reply-del', createdAt: 100 }]);

    s.applyOwnDeletions(['like-del', 'reply-del']);

    const next = useNostrSocialStore.getState();
    expect(next.engagementByEventId.t1.liked).toBeUndefined(); // like deleted → un-highlight
    expect(next.engagementByEventId.t1.reposted?.ownEventId).toBe('repost-keep'); // sibling kept
    expect(next.engagementByEventId.t3).toBeUndefined(); // last action gone → record dropped
  });
});
