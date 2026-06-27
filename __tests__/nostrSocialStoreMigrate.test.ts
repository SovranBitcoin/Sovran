/* eslint-disable import/first */

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

import { migrateNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';

describe('migrateNostrSocialStore v1 → v2', () => {
  it('folds the three legacy parallel maps into engagementByEventId', () => {
    const v1 = {
      contactsContent: 'x',
      likesByEventId: { e1: { reactionEventId: 'like1', updatedAt: 100 } },
      repostsByEventId: { e1: { repostEventId: 'rp1', updatedAt: 120 } },
      repliedByEventId: { e2: { replyEventId: 'rep1', updatedAt: 90 } },
    };

    const out = migrateNostrSocialStore(v1, 1) as {
      contactsContent: string;
      engagementByEventId: Record<
        string,
        {
          liked?: { ownEventId?: string };
          reposted?: { ownEventId?: string };
          replied?: { ownEventId?: string };
          updatedAt: number;
        }
      >;
      likesByEventId?: unknown;
    };

    expect(out.contactsContent).toBe('x'); // unrelated fields preserved
    expect(out.likesByEventId).toBeUndefined(); // legacy maps dropped
    expect(out.engagementByEventId.e1).toMatchObject({
      liked: { ownEventId: 'like1' },
      reposted: { ownEventId: 'rp1' },
      updatedAt: 120, // newest contributing action
    });
    expect(out.engagementByEventId.e2.replied).toEqual({ ownEventId: 'rep1' });
  });

  it('leaves an already-v2 blob untouched', () => {
    const v2 = { engagementByEventId: { e1: { liked: { ownEventId: 'l' }, updatedAt: 5 } } };
    const out = migrateNostrSocialStore(v2, 2) as typeof v2;
    expect(out.engagementByEventId.e1.updatedAt).toBe(5);
  });
});
