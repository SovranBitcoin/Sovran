import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { storeLog } from '@/shared/lib/logger';

const profileStorage = createProfileScopedStorage();

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

  syncLikesFromRelay: (
    targetEventIds: string[],
    likes: Array<{ targetEventId: string; reactionEventId: string; createdAt: number }>
  ) => void;
  syncRepostsFromRelay: (
    targetEventIds: string[],
    reposts: Array<{ targetEventId: string; repostEventId: string; createdAt: number }>
  ) => void;

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
  clearSettledEngagementOptimistic: () => void;

  clearAllData: () => Promise<void>;
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
  deletedRepostOriginalIds: {},
  optimisticFollowsByPubkey: {},
  optimisticLikesByEventId: {},
  optimisticRepostsByEventId: {},
};

export const useNostrSocialStore = create<NostrSocialStore>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,

      // ---- contacts ----

      setContactsFromRelay: ({ tags, content, createdAt }) => {
        set((state) => {
          if (createdAt < state.contactsUpdatedAt) {
            storeLog.debug('social.contacts.stale', { createdAt, current: state.contactsUpdatedAt });
            return state;
          }
          const following = extractFollowingFromTags(tags);
          storeLog.info('social.contacts.set', { tagCount: tags.length, followingCount: Object.keys(following).length, createdAt });
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
          const cleared = Object.keys(state.optimisticFollowsByPubkey).length - Object.keys(next).length;
          if (cleared > 0) storeLog.debug('social.follow.settled.clear', { cleared, remaining: Object.keys(next).length });
          return { optimisticFollowsByPubkey: next };
        });
      },

      // ---- repost deletion tracking ----

      markRepostDeleted: (originalEventId) => {
        storeLog.debug('social.repost.markDeleted', { originalEventId: originalEventId.slice(0, 8) });
        set((state) => ({
          deletedRepostOriginalIds: {
            ...state.deletedRepostOriginalIds,
            [originalEventId]: Date.now(),
          },
        }));
      },

      unmarkRepostDeleted: (originalEventId) => {
        storeLog.debug('social.repost.unmarkDeleted', { originalEventId: originalEventId.slice(0, 8) });
        set((state) => ({
          deletedRepostOriginalIds: omitKey(state.deletedRepostOriginalIds, originalEventId),
        }));
      },

      // ---- sync from relay ----

      syncLikesFromRelay: (targetEventIds, likes) => {
        storeLog.info('social.likes.sync', { targetCount: targetEventIds.length, likeCount: likes.length });
        const byTarget: Record<string, NostrReactionState> = {};
        for (const like of likes) {
          const existing = byTarget[like.targetEventId];
          if (!existing || like.createdAt >= existing.updatedAt) {
            byTarget[like.targetEventId] = {
              reactionEventId: like.reactionEventId,
              updatedAt: like.createdAt,
            };
          }
        }

        set((state) => {
          const nextLikes = { ...state.likesByEventId };
          for (const id of targetEventIds) {
            const relay = byTarget[id];
            if (relay) nextLikes[id] = relay;
            else delete nextLikes[id];
          }
          return { likesByEventId: nextLikes };
        });
      },

      syncRepostsFromRelay: (targetEventIds, reposts) => {
        storeLog.info('social.reposts.sync', { targetCount: targetEventIds.length, repostCount: reposts.length });
        const byTarget: Record<string, NostrRepostState> = {};
        for (const repost of reposts) {
          const existing = byTarget[repost.targetEventId];
          if (!existing || repost.createdAt >= existing.updatedAt) {
            byTarget[repost.targetEventId] = {
              repostEventId: repost.repostEventId,
              updatedAt: repost.createdAt,
            };
          }
        }

        set((state) => {
          const nextReposts = { ...state.repostsByEventId };
          const nextDeleted = { ...state.deletedRepostOriginalIds };
          for (const id of targetEventIds) {
            const relay = byTarget[id];
            if (relay) {
              nextReposts[id] = relay;
            } else {
              delete nextReposts[id];
              delete nextDeleted[id];
            }
          }
          return { repostsByEventId: nextReposts, deletedRepostOriginalIds: nextDeleted };
        });
      },

      // ---- engagement optimistic ----

      setLikeOptimistic: (eventId, params) => {
        storeLog.debug('social.like.optimistic', { eventId: eventId.slice(0, 8), value: params.value, pending: params.pending });
        set((state) => ({
          optimisticLikesByEventId: withOptimisticEntry(
            state.optimisticLikesByEventId,
            eventId,
            params
          ),
        }));
      },

      setRepostOptimistic: (eventId, params) => {
        storeLog.debug('social.repost.optimistic', { eventId: eventId.slice(0, 8), value: params.value, pending: params.pending });
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

      clearSettledEngagementOptimistic: () => {
        set((state) => {
          const filterSettled = <Base>(
            optimistic: Record<string, EngagementOptimisticState>,
            base: Record<string, Base>
          ) => {
            const next: Record<string, EngagementOptimisticState> = {};
            for (const [id, opt] of Object.entries(optimistic)) {
              if (opt.pending || opt.value !== !!base[id]) next[id] = opt;
            }
            return next;
          };

          const nextLikes = filterSettled(state.optimisticLikesByEventId, state.likesByEventId);
          const nextReposts = filterSettled(state.optimisticRepostsByEventId, state.repostsByEventId);
          const clearedLikes = Object.keys(state.optimisticLikesByEventId).length - Object.keys(nextLikes).length;
          const clearedReposts = Object.keys(state.optimisticRepostsByEventId).length - Object.keys(nextReposts).length;
          if (clearedLikes > 0 || clearedReposts > 0) {
            storeLog.debug('social.engagement.settled.clear', { clearedLikes, clearedReposts });
          }

          return {
            optimisticLikesByEventId: nextLikes,
            optimisticRepostsByEventId: nextReposts,
          };
        });
      },

      // ---- reset ----

      clearAllData: async () => {
        storeLog.info('social.clearAll');
        await profileStorage.removeItem('nostr-social-store');
        set(INITIAL_STATE);
      },
    }),
    {
      name: 'nostr-social-store',
      storage: createJSONStorage(() => createProfileScopedStorage()),
      partialize: (state) => ({
        contactsTags: state.contactsTags,
        contactsContent: state.contactsContent,
        contactsUpdatedAt: state.contactsUpdatedAt,
        followingPubkeys: state.followingPubkeys,
        likesByEventId: state.likesByEventId,
        repostsByEventId: state.repostsByEventId,
        deletedRepostOriginalIds: state.deletedRepostOriginalIds,
        optimisticFollowsByPubkey: state.optimisticFollowsByPubkey,
        optimisticLikesByEventId: state.optimisticLikesByEventId,
        optimisticRepostsByEventId: state.optimisticRepostsByEventId,
      }),
    }
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

export const selectFollowingSet = (state: NostrSocialStore) => {
  const result = new Set<string>(Object.keys(state.followingPubkeys));
  for (const [pubkey, optimistic] of Object.entries(state.optimisticFollowsByPubkey)) {
    if (optimistic.value) result.add(pubkey);
    else result.delete(pubkey);
  }
  return result;
};
