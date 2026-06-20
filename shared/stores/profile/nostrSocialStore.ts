import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NostrReactionState = {
  reactionEventId?: string;
  updatedAt: number;
};

type NostrRepostState = {
  repostEventId?: string;
  updatedAt: number;
};

type NostrRepliedState = {
  replyEventId?: string;
  updatedAt: number;
};

/**
 * Recency cap on the canonical own-engagement maps. The global own-events sync
 * (`useOwnEventsSync`) can backfill thousands of our likes/reposts/replies; cap
 * each map to the most-recent N by `updatedAt` so the persisted blob and
 * rehydrate stay bounded. Engagement older than the cap simply won't highlight
 * (rare, and the post would have to be re-encountered).
 */
const MAX_ENGAGEMENT_ENTRIES = 5000;

type FollowOptimisticState = {
  value: boolean;
  pending: boolean;
  updatedAt: number;
};

type EngagementOptimisticState = {
  value: boolean;
  pending: boolean;
  delta: number;
  expectedCount?: number;
  relatedEventId?: string;
  updatedAt: number;
};

interface NostrSocialState {
  contactsTags: string[][];
  contactsContent: string;
  contactsUpdatedAt: number;
  followingPubkeys: Record<string, true>;

  likesByEventId: Record<string, NostrReactionState>;
  repostsByEventId: Record<string, NostrRepostState>;
  /** Target event id → our reply to it. Drives the "you replied" highlight. */
  repliedByEventId: Record<string, NostrRepliedState>;
  deletedRepostOriginalIds: Record<string, number>;

  optimisticFollowsByPubkey: Record<string, FollowOptimisticState>;
  optimisticLikesByEventId: Record<string, EngagementOptimisticState>;
  optimisticRepostsByEventId: Record<string, EngagementOptimisticState>;
}

interface NostrSocialActions {
  setContactsFromRelay: (params: { tags: string[][]; content: string; createdAt: number }) => void;
  setFollowOptimistic: (pubkey: string, value: boolean, pending: boolean) => void;
  clearFollowOptimistic: (pubkey: string) => void;
  clearSettledFollowOptimistic: () => void;

  markRepostDeleted: (originalEventId: string) => void;
  unmarkRepostDeleted: (originalEventId: string) => void;

  /**
   * Global upsert of our own likes from the own-events sync. Unlike the legacy
   * scoped `syncLikesFromRelay`, this never deletes (no on-screen target set):
   * it merges newer entries and recency-caps. Deletions arrive via
   * {@link applyOwnDeletions}.
   */
  ingestOwnLikes: (
    likes: { targetEventId: string; reactionEventId: string; createdAt: number }[]
  ) => void;
  ingestOwnReposts: (
    reposts: { targetEventId: string; repostEventId: string; createdAt: number }[]
  ) => void;
  ingestOwnReplies: (
    replies: { targetEventId: string; replyEventId: string; createdAt: number }[]
  ) => void;
  /** Apply our own kind:5 deletions: drop any like/repost/reply whose own event id was deleted. */
  applyOwnDeletions: (deletedEventIds: string[]) => void;

  setLikeOptimistic: (
    eventId: string,
    params: {
      value: boolean;
      pending: boolean;
      delta: number;
      expectedCount?: number;
      relatedEventId?: string;
    }
  ) => void;
  setRepostOptimistic: (
    eventId: string,
    params: {
      value: boolean;
      pending: boolean;
      delta: number;
      expectedCount?: number;
      relatedEventId?: string;
    }
  ) => void;
  clearLikeOptimistic: (eventId: string) => void;
  clearRepostOptimistic: (eventId: string) => void;
}

type NostrSocialStore = NostrSocialState & NostrSocialActions;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractFollowingFromTags(tags: string[][]): Record<string, true> {
  const map: Record<string, true> = {};
  for (const tag of tags) {
    if (tag[0] === 'p' && tag[1]) {
      map[tag[1]] = true;
    }
  }
  return map;
}

/** Delete a key from a record immutably. */
function omitKey<V>(record: Record<string, V>, key: string): Record<string, V> {
  const next = { ...record };
  delete next[key];
  return next;
}

/** Set a timestamped optimistic entry for a given map key. */
function withOptimisticEntry<V extends { updatedAt: number }>(
  map: Record<string, V>,
  key: string,
  params: Omit<V, 'updatedAt'>
): Record<string, V> {
  return { ...map, [key]: { ...params, updatedAt: Date.now() } as unknown as V };
}

/** Keep only the `max` most-recent entries (by `updatedAt`); no-op under the cap. */
function capByRecency<V extends { updatedAt: number }>(
  map: Record<string, V>,
  max: number
): Record<string, V> {
  const keys = Object.keys(map);
  if (keys.length <= max) return map;
  const kept = keys
    .sort((a, b) => map[b].updatedAt - map[a].updatedAt)
    .slice(0, max);
  const next: Record<string, V> = {};
  for (const key of kept) next[key] = map[key];
  return next;
}

/** Merge own-engagement rows (target → record) into a map, keeping the newest per target. */
function upsertByTarget<V extends { updatedAt: number }>(
  base: Record<string, V>,
  rows: { targetEventId: string; createdAt: number; record: V }[]
): Record<string, V> {
  const next = { ...base };
  for (const { targetEventId, createdAt, record } of rows) {
    const existing = next[targetEventId];
    if (!existing || createdAt >= existing.updatedAt) next[targetEventId] = record;
  }
  return capByRecency(next, MAX_ENGAGEMENT_ENTRIES);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const INITIAL_STATE: NostrSocialState = {
  contactsTags: [],
  contactsContent: '',
  contactsUpdatedAt: 0,
  followingPubkeys: {},
  likesByEventId: {},
  repostsByEventId: {},
  repliedByEventId: {},
  deletedRepostOriginalIds: {},
  optimisticFollowsByPubkey: {},
  optimisticLikesByEventId: {},
  optimisticRepostsByEventId: {},
};

// Bounded schemas - `nostrSocialStore` persists up to three optimistic maps
// that grow unbounded if the user hammers reactions/follows offline. The .max()
// caps below stop a runaway blob from hanging rehydrate; if the limits are hit
// the merge falls back to defaults.
const PersistedReactionState = z.looseObject({
  reactionEventId: z.string().max(128).optional(),
  updatedAt: z.number().int().nonnegative(),
});
const PersistedRepostState = z.looseObject({
  repostEventId: z.string().max(128).optional(),
  updatedAt: z.number().int().nonnegative(),
});
const PersistedRepliedState = z.looseObject({
  replyEventId: z.string().max(128).optional(),
  updatedAt: z.number().int().nonnegative(),
});
const PersistedFollowOptimistic = z.looseObject({
  value: z.boolean(),
  pending: z.boolean(),
  updatedAt: z.number().int().nonnegative(),
});
const PersistedEngagementOptimistic = z.looseObject({
  value: z.boolean(),
  pending: z.boolean(),
  delta: z.number(),
  expectedCount: z.number().int().optional(),
  relatedEventId: z.string().max(128).optional(),
  updatedAt: z.number().int().nonnegative(),
});

const PersistedNostrSocialStore = z.object({
  contactsTags: z
    .array(z.array(z.string().max(2048)).max(16))
    .max(50_000)
    .default([]),
  contactsContent: z.string().max(65_536).default(''),
  contactsUpdatedAt: z.number().int().nonnegative().default(0),
  followingPubkeys: z.record(z.string().max(128), z.literal(true)).default({}),
  likesByEventId: z
    .record(z.string().max(128), PersistedReactionState)
    .default({}),
  repostsByEventId: z
    .record(z.string().max(128), PersistedRepostState)
    .default({}),
  repliedByEventId: z
    .record(z.string().max(128), PersistedRepliedState)
    .default({}),
  deletedRepostOriginalIds: z
    .record(z.string().max(128), z.number().int().nonnegative())
    .default({}),
  optimisticFollowsByPubkey: z.record(z.string().max(128), PersistedFollowOptimistic).default({}),
  optimisticLikesByEventId: z
    .record(z.string().max(128), PersistedEngagementOptimistic)
    .default({}),
  optimisticRepostsByEventId: z
    .record(z.string().max(128), PersistedEngagementOptimistic)
    .default({}),
});

export const useNostrSocialStore = create<NostrSocialStore>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,

      // ---- contacts ----

      setContactsFromRelay: ({ tags, content, createdAt }) => {
        set((state) => {
          if (createdAt < state.contactsUpdatedAt) {
            storeLog.debug('social.contacts.stale', {
              createdAt,
              current: state.contactsUpdatedAt,
            });
            return state;
          }
          const following = extractFollowingFromTags(tags);
          storeLog.info('social.contacts.set', {
            tagCount: tags.length,
            followingCount: Object.keys(following).length,
            createdAt,
          });
          return {
            contactsTags: tags,
            contactsContent: content,
            contactsUpdatedAt: createdAt,
            followingPubkeys: following,
          };
        });
      },

      // ---- follow optimistic ----

      setFollowOptimistic: (pubkey, value, pending) => {
        storeLog.debug('social.follow.optimistic', { pubkey: pubkey.slice(0, 8), value, pending });
        set((state) => ({
          optimisticFollowsByPubkey: withOptimisticEntry(state.optimisticFollowsByPubkey, pubkey, {
            value,
            pending,
          }),
        }));
      },

      clearFollowOptimistic: (pubkey) => {
        storeLog.debug('social.follow.optimistic.clear', { pubkey: pubkey.slice(0, 8) });
        set((state) => ({
          optimisticFollowsByPubkey: omitKey(state.optimisticFollowsByPubkey, pubkey),
        }));
      },

      clearSettledFollowOptimistic: () => {
        set((state) => {
          const next: Record<string, FollowOptimisticState> = {};
          for (const [pubkey, opt] of Object.entries(state.optimisticFollowsByPubkey)) {
            if (opt.pending || opt.value !== !!state.followingPubkeys[pubkey]) {
              next[pubkey] = opt;
            }
          }
          const cleared =
            Object.keys(state.optimisticFollowsByPubkey).length - Object.keys(next).length;
          if (cleared > 0)
            storeLog.debug('social.follow.settled.clear', {
              cleared,
              remaining: Object.keys(next).length,
            });
          return { optimisticFollowsByPubkey: next };
        });
      },

      // ---- repost deletion tracking ----

      markRepostDeleted: (originalEventId) => {
        storeLog.debug('social.repost.markDeleted', {
          originalEventId: originalEventId.slice(0, 8),
        });
        set((state) => ({
          deletedRepostOriginalIds: {
            ...state.deletedRepostOriginalIds,
            [originalEventId]: Date.now(),
          },
        }));
      },

      unmarkRepostDeleted: (originalEventId) => {
        storeLog.debug('social.repost.unmarkDeleted', {
          originalEventId: originalEventId.slice(0, 8),
        });
        set((state) => ({
          deletedRepostOriginalIds: omitKey(state.deletedRepostOriginalIds, originalEventId),
        }));
      },

      // ---- own-events sync (global upsert; see useOwnEventsSync) ----

      ingestOwnLikes: (likes) => {
        if (likes.length === 0) return;
        storeLog.info('social.likes.ingest', { likeCount: likes.length });
        set((state) => ({
          likesByEventId: upsertByTarget(
            state.likesByEventId,
            likes.map((l) => ({
              targetEventId: l.targetEventId,
              createdAt: l.createdAt,
              record: { reactionEventId: l.reactionEventId, updatedAt: l.createdAt },
            }))
          ),
        }));
      },

      ingestOwnReposts: (reposts) => {
        if (reposts.length === 0) return;
        storeLog.info('social.reposts.ingest', { repostCount: reposts.length });
        set((state) => ({
          repostsByEventId: upsertByTarget(
            state.repostsByEventId,
            reposts.map((r) => ({
              targetEventId: r.targetEventId,
              createdAt: r.createdAt,
              record: { repostEventId: r.repostEventId, updatedAt: r.createdAt },
            }))
          ),
        }));
      },

      ingestOwnReplies: (replies) => {
        if (replies.length === 0) return;
        storeLog.info('social.replies.ingest', { replyCount: replies.length });
        set((state) => ({
          repliedByEventId: upsertByTarget(
            state.repliedByEventId,
            replies.map((r) => ({
              targetEventId: r.targetEventId,
              createdAt: r.createdAt,
              record: { replyEventId: r.replyEventId, updatedAt: r.createdAt },
            }))
          ),
        }));
      },

      applyOwnDeletions: (deletedEventIds) => {
        if (deletedEventIds.length === 0) return;
        const deleted = new Set(deletedEventIds);
        set((state) => {
          const prune = <V extends { [k: string]: unknown }>(
            map: Record<string, V>,
            ownIdKey: keyof V
          ): { next: Record<string, V>; removed: number } => {
            let removed = 0;
            const next: Record<string, V> = {};
            for (const [target, record] of Object.entries(map)) {
              const ownId = record[ownIdKey];
              if (typeof ownId === 'string' && deleted.has(ownId)) {
                removed += 1;
                continue;
              }
              next[target] = record;
            }
            return { next, removed };
          };
          const likes = prune(state.likesByEventId, 'reactionEventId');
          const reposts = prune(state.repostsByEventId, 'repostEventId');
          const replies = prune(state.repliedByEventId, 'replyEventId');
          const removed = likes.removed + reposts.removed + replies.removed;
          if (removed > 0) storeLog.info('social.own.deletions_applied', { removed });
          return {
            likesByEventId: likes.next,
            repostsByEventId: reposts.next,
            repliedByEventId: replies.next,
          };
        });
      },

      // ---- engagement optimistic ----

      setLikeOptimistic: (eventId, params) => {
        storeLog.debug('social.like.optimistic', {
          eventId: eventId.slice(0, 8),
          value: params.value,
          pending: params.pending,
        });
        set((state) => ({
          optimisticLikesByEventId: withOptimisticEntry(
            state.optimisticLikesByEventId,
            eventId,
            params
          ),
        }));
      },

      setRepostOptimistic: (eventId, params) => {
        storeLog.debug('social.repost.optimistic', {
          eventId: eventId.slice(0, 8),
          value: params.value,
          pending: params.pending,
        });
        set((state) => ({
          optimisticRepostsByEventId: withOptimisticEntry(
            state.optimisticRepostsByEventId,
            eventId,
            params
          ),
        }));
      },

      clearLikeOptimistic: (eventId) => {
        storeLog.debug('social.like.optimistic.clear', { eventId: eventId.slice(0, 8) });
        set((state) => ({
          optimisticLikesByEventId: omitKey(state.optimisticLikesByEventId, eventId),
        }));
      },

      clearRepostOptimistic: (eventId) => {
        storeLog.debug('social.repost.optimistic.clear', { eventId: eventId.slice(0, 8) });
        set((state) => ({
          optimisticRepostsByEventId: omitKey(state.optimisticRepostsByEventId, eventId),
        }));
      },
    }),
    persistConfig({
      name: 'nostr-social-store',
      storage: createProfileScopedStorage(),
      schema: PersistedNostrSocialStore,
      logKey: 'nostr_social',
      partialize: (state) => ({
        contactsTags: state.contactsTags,
        contactsContent: state.contactsContent,
        contactsUpdatedAt: state.contactsUpdatedAt,
        followingPubkeys: state.followingPubkeys,
        likesByEventId: state.likesByEventId,
        repostsByEventId: state.repostsByEventId,
        repliedByEventId: state.repliedByEventId,
        deletedRepostOriginalIds: state.deletedRepostOriginalIds,
        optimisticFollowsByPubkey: state.optimisticFollowsByPubkey,
        optimisticLikesByEventId: state.optimisticLikesByEventId,
        optimisticRepostsByEventId: state.optimisticRepostsByEventId,
      }),
    })
  )
);

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectIsFollowingPubkey = (pubkey: string) => (state: NostrSocialStore) => {
  const optimistic = state.optimisticFollowsByPubkey[pubkey];
  if (optimistic) return optimistic.value;
  return !!state.followingPubkeys[pubkey];
};
