import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { tolerantRecord } from '@/shared/lib/persist/tolerant';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One of our own actions on a target event (the `ownEventId` is OUR reaction / repost / reply). */
type EngagementAction = { ownEventId?: string };

/**
 * Our viewer-state for a single target event: which of like / repost / reply we
 * did, each with our own event id. ONE record per target replaces the former
 * three parallel maps — adding a new engagement type (e.g. zap, bookmark) is a
 * field here, not a whole new map. Confirmed state only; the optimistic overlay
 * lives in the `optimistic*` maps and is merged by readers.
 */
type EngagementRecord = {
  liked?: EngagementAction;
  reposted?: EngagementAction;
  replied?: EngagementAction;
  /** Newest contributing action's `created_at`, for the recency cap. */
  updatedAt: number;
};

/**
 * Recency cap on the canonical own-engagement map. The global own-events sync
 * (`useOwnEventsSync`) can backfill thousands of our likes/reposts/replies; cap
 * the map to the most-recent N records by `updatedAt` so the persisted blob and
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

/**
 * Optimistic zap overlay for one target event. Unlike likes/reposts a zap is
 * additive sats, not a boolean toggle: `deltaSats` accumulates across multiple
 * zaps on the same post, `expectedSats` is the base `satsZapped` at zap time
 * plus the delta (the entry clears only once the aggregated 9735 counts catch
 * up — never age-out, which would visibly DECREASE the display).
 */
type ZapOptimisticState = {
  deltaSats: number;
  pending: boolean;
  expectedSats?: number;
  updatedAt: number;
};

/**
 * Durable "I zapped this post" record — drives the amber lightning highlight.
 * Separate from the optimistic count overlay, which is deliberately cleared
 * once nagg's aggregated `satsZapped` catches up: without this record the
 * highlight would vanish at that moment (and never appear at all for zaps
 * whose sat amount couldn't be attributed). `totalSats` accumulates across
 * repeat zaps on the same post.
 */
type ZappedRecord = {
  totalSats: number;
  updatedAt: number;
};

/** Recency cap for the durable zapped map (mirrors the engagement cap idea). */
const MAX_ZAPPED_ENTRIES = 2000;

interface NostrSocialState {
  contactsTags: string[][];
  contactsContent: string;
  contactsUpdatedAt: number;
  followingPubkeys: Record<string, true>;

  /**
   * Target event id → our engagement record (liked / reposted / replied). One
   * unified map; the `replied` field drives the "you replied" highlight.
   */
  engagementByEventId: Record<string, EngagementRecord>;
  deletedRepostOriginalIds: Record<string, number>;
  /**
   * Note ids for which WE published a kind:5 deletion request (value =
   * requestedAt ms). Drives the greyed "Delete requested" tombstone in our own
   * feed — NIP-09 is a request, not a guarantee, so the note may still be
   * served by some relays and we keep showing the placeholder rather than
   * silently hiding it.
   */
  deletedNoteIds: Record<string, number>;

  optimisticFollowsByPubkey: Record<string, FollowOptimisticState>;
  optimisticLikesByEventId: Record<string, EngagementOptimisticState>;
  optimisticRepostsByEventId: Record<string, EngagementOptimisticState>;
  optimisticZapsByEventId: Record<string, ZapOptimisticState>;
  zappedByEventId: Record<string, ZappedRecord>;
}

interface NostrSocialActions {
  setContactsFromRelay: (params: { tags: string[][]; content: string; createdAt: number }) => void;
  /**
   * Seed the read-side follow set from the tiered facade's social-graph bundle
   * (nagg → Primal → relay). Read-only accelerator: it sets `followingPubkeys`
   * and bumps the LWW gate but NEVER writes `contactsTags`/`content` — the raw
   * kind-3 from `useOwnEventsSync`'s relay sub stays the write-authoritative
   * source for follow/unfollow re-publish (it preserves relay hints + petnames
   * the facade's parsed `follows` drop). LWW-gated by the kind-3 `created_at` so
   * a facade seed and a relay delta can't fight — the newer contact list wins.
   */
  seedFollowsFromFacade: (params: { follows: string[]; createdAt: number }) => void;
  setFollowOptimistic: (pubkey: string, value: boolean, pending: boolean) => void;
  clearFollowOptimistic: (pubkey: string) => void;
  clearSettledFollowOptimistic: () => void;

  markRepostDeleted: (originalEventId: string) => void;
  unmarkRepostDeleted: (originalEventId: string) => void;

  /** Record that we requested deletion of our own note (NIP-09 kind:5 sent). */
  markDeleteRequested: (noteId: string) => void;

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

  /**
   * A zap melt was confirmed paid. Sets the durable zapped record (highlight)
   * and — when `sats > 0` — an already-settled optimistic count bump that
   * clears once nagg's aggregated `satsZapped` reaches `expectedSats`.
   * `sats: 0` (fiat-unit melt whose sat value is unknown app-side) records
   * the highlight only; the public count self-heals via the 9735 aggregate.
   */
  recordZapPaid: (eventId: string, sats: number, baseSats?: number) => void;
  clearZapOptimistic: (eventId: string) => void;
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
  const kept = keys.sort((a, b) => map[b].updatedAt - map[a].updatedAt).slice(0, max);
  const next: Record<string, V> = {};
  for (const key of kept) next[key] = map[key];
  return next;
}

type EngagementActionKind = 'liked' | 'reposted' | 'replied';

/**
 * Merge one action type's own-engagement rows into the unified map: set the
 * action on each target's record (preserving the record's other actions) and
 * advance `updatedAt`. Recency-caps by record. Replaces the former per-map
 * `upsertByTarget` — the merge is now additive across action types.
 */
// --- persisted-shape migration (v1 → v2) -----------------------------------

type LegacyEngagementAction = {
  reactionEventId?: string;
  repostEventId?: string;
  replyEventId?: string;
  updatedAt?: number;
};
type LegacyV1 = {
  likesByEventId?: Record<string, LegacyEngagementAction>;
  repostsByEventId?: Record<string, LegacyEngagementAction>;
  repliedByEventId?: Record<string, LegacyEngagementAction>;
  engagementByEventId?: Record<string, EngagementRecord>;
  [k: string]: unknown;
};

/**
 * v1 → v2: fold the three legacy parallel maps (likes/reposts/repliedByEventId)
 * into the unified `engagementByEventId`. Without this, the v1 blob's old keys
 * are stripped by the schema merge and engagement state silently resets until a
 * slow relay backfill re-derives it (dropping anything older than the backfill
 * window). The values are 1:1 field-compatible, so the fold is lossless.
 */
function v1ToV2(state: unknown): unknown {
  const s = (state ?? {}) as LegacyV1;
  if (!s.likesByEventId && !s.repostsByEventId && !s.repliedByEventId) return s; // already v2 / fresh

  const merged: Record<string, EngagementRecord> = { ...(s.engagementByEventId ?? {}) };
  const fold = (
    map: Record<string, LegacyEngagementAction> | undefined,
    field: 'liked' | 'reposted' | 'replied',
    idKey: 'reactionEventId' | 'repostEventId' | 'replyEventId'
  ) => {
    for (const [target, entry] of Object.entries(map ?? {})) {
      const at = entry.updatedAt ?? 0;
      const rec = merged[target] ?? { updatedAt: 0 };
      merged[target] = {
        ...rec,
        [field]: entry[idKey] ? { ownEventId: entry[idKey] } : {},
        updatedAt: Math.max(rec.updatedAt, at),
      };
    }
  };
  fold(s.likesByEventId, 'liked', 'reactionEventId');
  fold(s.repostsByEventId, 'reposted', 'repostEventId');
  fold(s.repliedByEventId, 'replied', 'replyEventId');

  // Dropped on purpose: the three per-action maps are folded into
  // `engagementByEventId` above and must not survive into v2.
  const {
    likesByEventId: _likes,
    repostsByEventId: _reposts,
    repliedByEventId: _replied,
    ...rest
  } = s;
  return { ...rest, engagementByEventId: capByRecency(merged, MAX_ENGAGEMENT_ENTRIES) };
}

/** Per-store SHAPE migration (vs the cross-store dataMigrations registry). */
export function migrateNostrSocialStore(state: unknown, version: number): unknown {
  let s = state;
  if (version < 2) s = v1ToV2(s);
  return s;
}

function ingestEngagementAction(
  base: Record<string, EngagementRecord>,
  action: EngagementActionKind,
  rows: { targetEventId: string; ownEventId: string; createdAt: number }[]
): Record<string, EngagementRecord> {
  const next = { ...base };
  for (const { targetEventId, ownEventId, createdAt } of rows) {
    const existing = next[targetEventId];
    next[targetEventId] = {
      ...existing,
      [action]: { ownEventId },
      updatedAt: Math.max(existing?.updatedAt ?? 0, createdAt),
    };
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
  engagementByEventId: {},
  deletedRepostOriginalIds: {},
  deletedNoteIds: {},
  optimisticFollowsByPubkey: {},
  optimisticLikesByEventId: {},
  optimisticRepostsByEventId: {},
  optimisticZapsByEventId: {},
  zappedByEventId: {},
};

// Bounded schemas - `nostrSocialStore` persists up to three optimistic maps
// that grow unbounded if the user hammers reactions/follows offline. The .max()
// caps below stop a runaway blob from hanging rehydrate; if the limits are hit
// the merge falls back to defaults.
const PersistedEngagementAction = z.looseObject({
  ownEventId: z.string().max(128).optional(),
});
const PersistedEngagementRecord = z.looseObject({
  liked: PersistedEngagementAction.optional(),
  reposted: PersistedEngagementAction.optional(),
  replied: PersistedEngagementAction.optional(),
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

const PersistedZapOptimistic = z.looseObject({
  deltaSats: z.number(),
  pending: z.boolean(),
  expectedSats: z.number().int().optional(),
  updatedAt: z.number().int().nonnegative(),
});

const PersistedZappedRecord = z.looseObject({
  totalSats: z.number(),
  updatedAt: z.number().int().nonnegative(),
});

const PersistedNostrSocialStore = z.object({
  contactsTags: z
    .array(z.array(z.string().max(2048)).max(16))
    .max(50_000)
    .default([]),
  contactsContent: z.string().max(65_536).default(''),
  contactsUpdatedAt: z.number().int().nonnegative().default(0),
  // Tolerant: the follow set is a set — the `true` carries no information, so
  // a corrupt value has nothing to fall back to. Bare, one bad entry would
  // reject the blob and take contactsTags, the engagement map and the deleted
  // -note ids with it; contained, it costs exactly the one follow.
  followingPubkeys: tolerantRecord(z.string().max(128), z.literal(true)),
  engagementByEventId: z.record(z.string().max(128), PersistedEngagementRecord).default({}),
  deletedRepostOriginalIds: z
    .record(z.string().max(128), z.number().int().nonnegative())
    .default({}),
  deletedNoteIds: z.record(z.string().max(128), z.number().int().nonnegative()).default({}),
  optimisticFollowsByPubkey: z.record(z.string().max(128), PersistedFollowOptimistic).default({}),
  optimisticLikesByEventId: z
    .record(z.string().max(128), PersistedEngagementOptimistic)
    .default({}),
  optimisticRepostsByEventId: z
    .record(z.string().max(128), PersistedEngagementOptimistic)
    .default({}),
  optimisticZapsByEventId: z.record(z.string().max(128), PersistedZapOptimistic).default({}),
  zappedByEventId: z.record(z.string().max(128), PersistedZappedRecord).default({}),
});

export const useNostrSocialStore = create<NostrSocialStore>()(
  persist(
    (set) => ({
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

      seedFollowsFromFacade: ({ follows, createdAt }) => {
        set((state) => {
          // LWW: skip when the authoritative kind-3 (relay sub) already landed
          // an equal-or-newer list. The relay path's own guard uses `<`, so an
          // equal `created_at` there still fills the raw `contactsTags` we leave
          // untouched here.
          if (createdAt <= state.contactsUpdatedAt) {
            storeLog.debug('social.contacts.seed.stale', {
              createdAt,
              current: state.contactsUpdatedAt,
            });
            return state;
          }
          const following = extractFollowingFromTags(follows.map((pk) => ['p', pk]));
          storeLog.info('social.contacts.seed', {
            followingCount: Object.keys(following).length,
            createdAt,
          });
          // Read side only — no `contactsTags`/`content`; the relay sub owns those.
          return { followingPubkeys: following, contactsUpdatedAt: createdAt };
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

      markDeleteRequested: (noteId) => {
        storeLog.info('social.note.markDeleteRequested', { noteId: noteId.slice(0, 8) });
        set((state) => ({
          deletedNoteIds: { ...state.deletedNoteIds, [noteId]: Date.now() },
        }));
      },

      // ---- own-events sync (global upsert; see useOwnEventsSync) ----

      ingestOwnLikes: (likes) => {
        if (likes.length === 0) return;
        storeLog.info('social.likes.ingest', { likeCount: likes.length });
        set((state) => ({
          engagementByEventId: ingestEngagementAction(
            state.engagementByEventId,
            'liked',
            likes.map((l) => ({
              targetEventId: l.targetEventId,
              ownEventId: l.reactionEventId,
              createdAt: l.createdAt,
            }))
          ),
        }));
      },

      ingestOwnReposts: (reposts) => {
        if (reposts.length === 0) return;
        storeLog.info('social.reposts.ingest', { repostCount: reposts.length });
        set((state) => ({
          engagementByEventId: ingestEngagementAction(
            state.engagementByEventId,
            'reposted',
            reposts.map((r) => ({
              targetEventId: r.targetEventId,
              ownEventId: r.repostEventId,
              createdAt: r.createdAt,
            }))
          ),
        }));
      },

      ingestOwnReplies: (replies) => {
        if (replies.length === 0) return;
        storeLog.info('social.replies.ingest', { replyCount: replies.length });
        set((state) => ({
          engagementByEventId: ingestEngagementAction(
            state.engagementByEventId,
            'replied',
            replies.map((r) => ({
              targetEventId: r.targetEventId,
              ownEventId: r.replyEventId,
              createdAt: r.createdAt,
            }))
          ),
        }));
      },

      applyOwnDeletions: (deletedEventIds) => {
        if (deletedEventIds.length === 0) return;
        const deleted = new Set(deletedEventIds);
        set((state) => {
          let removed = 0;
          const next: Record<string, EngagementRecord> = {};
          const actions: EngagementActionKind[] = ['liked', 'reposted', 'replied'];
          for (const [target, record] of Object.entries(state.engagementByEventId)) {
            const kept: EngagementRecord = { updatedAt: record.updatedAt };
            let changed = false;
            for (const action of actions) {
              const entry = record[action];
              if (!entry) continue;
              if (entry.ownEventId && deleted.has(entry.ownEventId)) {
                removed += 1;
                changed = true;
                continue;
              }
              kept[action] = entry;
            }
            // Drop the record only when its last surviving action is gone.
            if (kept.liked || kept.reposted || kept.replied) {
              next[target] = changed ? kept : record;
            }
          }
          if (removed > 0) storeLog.info('social.own.deletions_applied', { removed });
          return { engagementByEventId: next };
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

      // ---- zaps ----

      recordZapPaid: (eventId, sats, baseSats) => {
        storeLog.info('social.zap.paid', { eventId: eventId.slice(0, 8), sats });
        set((state) => {
          const zappedExisting = state.zappedByEventId[eventId];
          const zappedByEventId = capByRecency(
            {
              ...state.zappedByEventId,
              [eventId]: {
                totalSats: (zappedExisting?.totalSats ?? 0) + sats,
                updatedAt: Date.now(),
              },
            },
            MAX_ZAPPED_ENTRIES
          );
          if (sats <= 0) return { zappedByEventId };
          const optExisting = state.optimisticZapsByEventId[eventId];
          const deltaSats = (optExisting?.deltaSats ?? 0) + sats;
          return {
            zappedByEventId,
            optimisticZapsByEventId: withOptimisticEntry(state.optimisticZapsByEventId, eventId, {
              deltaSats,
              pending: false,
              expectedSats: (baseSats ?? 0) + deltaSats,
            }),
          };
        });
      },

      clearZapOptimistic: (eventId) => {
        storeLog.debug('social.zap.optimistic.clear', { eventId: eventId.slice(0, 8) });
        set((state) => ({
          optimisticZapsByEventId: omitKey(state.optimisticZapsByEventId, eventId),
        }));
      },
    }),
    persistConfig({
      name: 'nostr-social-store',
      storage: createProfileScopedStorage(),
      schema: PersistedNostrSocialStore,
      logKey: 'nostr_social',
      version: 2,
      migrate: migrateNostrSocialStore,
      partialize: (state) => ({
        contactsTags: state.contactsTags,
        contactsContent: state.contactsContent,
        contactsUpdatedAt: state.contactsUpdatedAt,
        followingPubkeys: state.followingPubkeys,
        engagementByEventId: state.engagementByEventId,
        deletedRepostOriginalIds: state.deletedRepostOriginalIds,
        deletedNoteIds: state.deletedNoteIds,
        optimisticFollowsByPubkey: state.optimisticFollowsByPubkey,
        optimisticLikesByEventId: state.optimisticLikesByEventId,
        optimisticRepostsByEventId: state.optimisticRepostsByEventId,
        optimisticZapsByEventId: state.optimisticZapsByEventId,
        zappedByEventId: state.zappedByEventId,
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

/** True when we've requested deletion of `noteId` — drives the tombstone. */
export const selectIsDeleteRequested = (noteId: string) => (state: NostrSocialStore) =>
  state.deletedNoteIds[noteId] !== undefined;
