import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createProfileScopedStorage } from '@/helper/profileScopedStorage';

const profileStorage = createProfileScopedStorage();

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

function extractFollowingFromTags(tags: string[][]): Record<string, true> {
  const map: Record<string, true> = {};
  for (const tag of tags) {
    if (tag[0] === 'p' && tag[1]) {
      map[tag[1]] = true;
    }
  }
  return map;
}

export const useNostrSocialStore = create<NostrSocialStore>()(
  persist(
    (set, get) => ({
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

      setContactsFromRelay: ({ tags, content, createdAt }) => {
        set((state) => {
          if (createdAt < state.contactsUpdatedAt) return state;
          return {
            ...state,
            contactsTags: tags,
            contactsContent: content,
            contactsUpdatedAt: createdAt,
            followingPubkeys: extractFollowingFromTags(tags),
          };
        });
      },

      setFollowOptimistic: (pubkey, value, pending) => {
        set((state) => ({
          ...state,
          optimisticFollowsByPubkey: {
            ...state.optimisticFollowsByPubkey,
            [pubkey]: { value, pending, updatedAt: Date.now() },
          },
        }));
      },

      clearFollowOptimistic: (pubkey) => {
        set((state) => {
          const next = { ...state.optimisticFollowsByPubkey };
          delete next[pubkey];
          return { ...state, optimisticFollowsByPubkey: next };
        });
      },

      clearSettledFollowOptimistic: () => {
        set((state) => {
          const next: Record<string, FollowOptimisticState> = {};
          for (const [pubkey, opt] of Object.entries(state.optimisticFollowsByPubkey)) {
            const base = !!state.followingPubkeys[pubkey];
            if (opt.pending || opt.value !== base) {
              next[pubkey] = opt;
            }
          }
          return { ...state, optimisticFollowsByPubkey: next };
        });
      },

      markRepostDeleted: (originalEventId) => {
        set((state) => ({
          ...state,
          deletedRepostOriginalIds: {
            ...state.deletedRepostOriginalIds,
            [originalEventId]: Date.now(),
          },
        }));
      },

      unmarkRepostDeleted: (originalEventId) => {
        set((state) => {
          const next = { ...state.deletedRepostOriginalIds };
          delete next[originalEventId];
          return { ...state, deletedRepostOriginalIds: next };
        });
      },

      syncLikesFromRelay: (targetEventIds, likes) => {
        const likeByTarget: Record<string, NostrReactionState> = {};
        for (const like of likes) {
          const existing = likeByTarget[like.targetEventId];
          if (!existing || like.createdAt >= existing.updatedAt) {
            likeByTarget[like.targetEventId] = {
              reactionEventId: like.reactionEventId,
              updatedAt: like.createdAt,
            };
          }
        }

        set((state) => {
          const nextLikes = { ...state.likesByEventId };
          for (const id of targetEventIds) {
            const relayValue = likeByTarget[id];
            if (relayValue) {
              nextLikes[id] = relayValue;
            } else {
              delete nextLikes[id];
            }
          }
          return { ...state, likesByEventId: nextLikes };
        });
      },

      syncRepostsFromRelay: (targetEventIds, reposts) => {
        const repostByTarget: Record<string, NostrRepostState> = {};
        for (const repost of reposts) {
          const existing = repostByTarget[repost.targetEventId];
          if (!existing || repost.createdAt >= existing.updatedAt) {
            repostByTarget[repost.targetEventId] = {
              repostEventId: repost.repostEventId,
              updatedAt: repost.createdAt,
            };
          }
        }

        set((state) => {
          const nextReposts = { ...state.repostsByEventId };
          const nextDeleted = { ...state.deletedRepostOriginalIds };
          for (const id of targetEventIds) {
            const relayValue = repostByTarget[id];
            if (relayValue) {
              nextReposts[id] = relayValue;
            } else {
              delete nextReposts[id];
              // Relay confirms no active repost — deletion has propagated
              delete nextDeleted[id];
            }
          }
          return {
            ...state,
            repostsByEventId: nextReposts,
            deletedRepostOriginalIds: nextDeleted,
          };
        });
      },

      setLikeOptimistic: (eventId, params) => {
        set((state) => ({
          ...state,
          optimisticLikesByEventId: {
            ...state.optimisticLikesByEventId,
            [eventId]: { ...params, updatedAt: Date.now() },
          },
        }));
      },

      setRepostOptimistic: (eventId, params) => {
        set((state) => ({
          ...state,
          optimisticRepostsByEventId: {
            ...state.optimisticRepostsByEventId,
            [eventId]: { ...params, updatedAt: Date.now() },
          },
        }));
      },

      clearLikeOptimistic: (eventId) => {
        set((state) => {
          const next = { ...state.optimisticLikesByEventId };
          delete next[eventId];
          return { ...state, optimisticLikesByEventId: next };
        });
      },

      clearRepostOptimistic: (eventId) => {
        set((state) => {
          const next = { ...state.optimisticRepostsByEventId };
          delete next[eventId];
          return { ...state, optimisticRepostsByEventId: next };
        });
      },

      clearSettledEngagementOptimistic: () => {
        set((state) => {
          const nextLikes: Record<string, EngagementOptimisticState> = {};
          for (const [eventId, opt] of Object.entries(state.optimisticLikesByEventId)) {
            const base = !!state.likesByEventId[eventId];
            if (opt.pending || opt.value !== base) {
              nextLikes[eventId] = opt;
            }
          }

          const nextReposts: Record<string, EngagementOptimisticState> = {};
          for (const [eventId, opt] of Object.entries(state.optimisticRepostsByEventId)) {
            const base = !!state.repostsByEventId[eventId];
            if (opt.pending || opt.value !== base) {
              nextReposts[eventId] = opt;
            }
          }

          return {
            ...state,
            optimisticLikesByEventId: nextLikes,
            optimisticRepostsByEventId: nextReposts,
          };
        });
      },

      clearAllData: async () => {
        await profileStorage.removeItem('nostr-social-store');
        set({
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
        });
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
