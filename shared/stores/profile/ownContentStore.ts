/**
 * @fileoverview `ownContentStore` — a per-profile local cache of the notes we
 * authored (kind:1: notes, replies, quotes).
 *
 * Two jobs, one deep module:
 *  1. Optimistic publish: a note is recorded the instant we publish it, so it
 *     is readable locally by id (the toast's "View" can open its thread before
 *     the event has round-tripped through relays/nagg).
 *  2. Cross-client convergence: own notes the app encounters from a relay /
 *     app-view (e.g. posted on another client) are ingested here too, so the
 *     app reflects our own content without depending on a live relay sub.
 *
 * Reconciliation is by exact `event.id` — a signed note already knows its id, so
 * the relay echo is the same key (no timestamp/content-hash guessing). Lifecycle:
 *   record('pending')  → publish in flight
 *   confirmOwn         → delivery assured (first relay accepted) → 'local'
 *   removeOwn          → publish failed → dropped (never a phantom)
 *   ingestSeen         → seen from a relay/app-view → 'confirmed'
 *
 * Profile isolation is defense-in-depth: profile-scoped persisted storage, plus
 * a per-entry `authorPubkey` that reads filter against the active viewer.
 *
 * Retention: `confirmed` entries are FIFO-capped; a `local` entry relays never
 * echo back ages out after a grace window (assumed landed); `pending`/`local`
 * are otherwise kept. On persist, `pending` is written as `local` so an
 * app-kill mid-publish rehydrates as a recoverable local copy rather than a
 * stuck pending.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

/** A note we authored is `pending` until publish is assured, then `local`
 *  until a relay/app-view echoes it back, then `confirmed`. */
type OwnContentStatus = 'pending' | 'local' | 'confirmed';

interface OwnContentEntry {
  /** The authored kind:1 event, in thread-renderable shape. */
  event: FeedEvent;
  /** Author pubkey — must match the active viewer to be read (profile isolation). */
  authorPubkey: string;
  status: OwnContentStatus;
  /** Epoch ms of the last status change (drives age-out + FIFO eviction). */
  updatedAt: number;
}

/** Max `confirmed` entries kept; older own notes are refetchable from nagg/relays. */
export const MAX_CONFIRMED = 200;
/** A `local` note relays never echo back is assumed landed after this and becomes evictable. */
export const LOCAL_GRACE_MS = 24 * 60 * 60 * 1000;

interface OwnContentStore {
  byId: Record<string, OwnContentEntry>;
  /** Record a note we authored at the given lifecycle status. */
  recordOwn: (event: FeedEvent, status: OwnContentStatus) => void;
  /** Promote a `pending` entry to `local` once delivery is assured. */
  confirmOwn: (id: string) => void;
  /** Drop an entry (publish failed) so a non-delivered post never renders. */
  removeOwn: (id: string) => void;
  /** Settle an own note encountered from a relay/app-view (→ `confirmed`). */
  ingestSeen: (event: FeedEvent) => void;
  /** Read a stored own note by id, scoped to the active author when supplied. */
  getOwn: (id: string, authorPubkey?: string) => OwnContentEntry | undefined;
}

const feedEventFrom = (event: FeedEvent): FeedEvent => ({
  id: event.id,
  kind: event.kind,
  pubkey: event.pubkey,
  content: event.content,
  tags: event.tags,
  created_at: event.created_at,
});

/** Drop aged-out `local` entries and FIFO-cap `confirmed`; keep recent pending/local. */
function prune(
  byId: Record<string, OwnContentEntry>,
  nowMs: number
): Record<string, OwnContentEntry> {
  const cutoff = nowMs - LOCAL_GRACE_MS;
  const kept: Record<string, OwnContentEntry> = {};
  const confirmed: OwnContentEntry[] = [];
  for (const [id, entry] of Object.entries(byId)) {
    if (entry.status === 'local' && entry.updatedAt < cutoff) continue; // assumed landed
    kept[id] = entry;
    if (entry.status === 'confirmed') confirmed.push(entry);
  }
  if (confirmed.length > MAX_CONFIRMED) {
    confirmed.sort((a, b) => a.updatedAt - b.updatedAt); // oldest first
    for (let i = 0; i < confirmed.length - MAX_CONFIRMED; i += 1) {
      delete kept[confirmed[i].event.id];
    }
  }
  return kept;
}

const PersistedFeedEvent = z.looseObject({
  id: z.string().max(128),
  kind: z.number().int(),
  pubkey: z.string().max(128),
  content: z.string().max(65_536),
  tags: z.array(z.array(z.string().max(8192)).max(200)).max(5000),
  created_at: z.number().int().nonnegative(),
});

const PersistedOwnEntry = z.looseObject({
  event: PersistedFeedEvent,
  authorPubkey: z.string().max(128),
  status: z.enum(['pending', 'local', 'confirmed']),
  updatedAt: z.number().int().nonnegative(),
});

const PersistedOwnContentStore = z.object({
  byId: z.record(z.string().max(128), PersistedOwnEntry).default({}),
});

export const useOwnContentStore = create<OwnContentStore>()(
  persist(
    (set, get) => ({
      byId: {},

      recordOwn: (event, status) =>
        set((state) => {
          const entry: OwnContentEntry = {
            event: feedEventFrom(event),
            authorPubkey: event.pubkey,
            status,
            updatedAt: Date.now(),
          };
          return { byId: prune({ ...state.byId, [event.id]: entry }, Date.now()) };
        }),

      confirmOwn: (id) =>
        set((state) => {
          const cur = state.byId[id];
          if (cur?.status !== 'pending') return state;
          return {
            byId: { ...state.byId, [id]: { ...cur, status: 'local', updatedAt: Date.now() } },
          };
        }),

      removeOwn: (id) =>
        set((state) => {
          if (!state.byId[id]) return state;
          const next = { ...state.byId };
          delete next[id];
          return { byId: next };
        }),

      ingestSeen: (event) =>
        set((state) => {
          const cur = state.byId[event.id];
          if (cur?.status === 'confirmed') return state; // already settled
          const entry: OwnContentEntry = {
            event: feedEventFrom(event),
            authorPubkey: event.pubkey,
            status: 'confirmed',
            updatedAt: Date.now(),
          };
          return { byId: prune({ ...state.byId, [event.id]: entry }, Date.now()) };
        }),

      getOwn: (id, authorPubkey) => {
        const entry = get().byId[id];
        if (!entry) return undefined;
        if (authorPubkey && entry.authorPubkey !== authorPubkey) return undefined;
        return entry;
      },
    }),
    persistConfig({
      name: 'own-content-store',
      storage: createProfileScopedStorage(),
      schema: PersistedOwnContentStore,
      logKey: 'own_content',
      // Persist `pending` as `local`: an app-kill mid-publish should rehydrate
      // as a recoverable local copy, never a stuck pending. A live pending that
      // fails is removed (removeOwn) and so leaves storage too.
      partialize: (state) => ({
        byId: Object.fromEntries(
          Object.entries(state.byId).map(([id, entry]) => [
            id,
            entry.status === 'pending' ? { ...entry, status: 'local' as const } : entry,
          ])
        ),
      }),
    })
  )
);

/**
 * Passive-ingest seam: record any own-authored kind:1 notes the app already
 * encountered (feed/thread/profile reads) as `confirmed`. No-op for events that
 * aren't ours — keeps cross-client convergence on the path the app already runs.
 */
export function ingestOwnContent(
  events: Iterable<FeedEvent>,
  viewerPubkey: string | undefined
): void {
  if (!viewerPubkey) return;
  const { ingestSeen } = useOwnContentStore.getState();
  for (const event of events) {
    if (event.kind === 1 && event.pubkey === viewerPubkey) ingestSeen(event);
  }
}
