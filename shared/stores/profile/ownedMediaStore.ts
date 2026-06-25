/**
 * @fileoverview `ownedMediaStore` — a durable, per-profile ledger of every
 * Blossom blob we own (images + other blossom-hosted links in our posts).
 *
 * Why a separate store from `ownContentStore`: that one is a bounded render
 * cache (FIFO-capped at 200, 24h local age-out) on the assumption evicted notes
 * are refetchable from relays. That assumption breaks for a DELETED post — the
 * kind:5 makes relays drop it — so its blob URLs would be lost, and a failed
 * blob deletion could never be retried. This store therefore NEVER prunes: a
 * blob entry is the only durable record of a URL we may still need to delete or
 * verify. Keyed by sha256 (content address) so the same blob dedups across URLs
 * and across clients posting with our key.
 *
 * Blobs arrive from: the create hook (`recordBlobs` in publishComposed) and the
 * passive ingest seams (`ingestOwnMediaBlobs`, mirroring `ingestOwnContent`).
 * Deletion writes `deleteState` here but NEVER removes the entry, so the
 * settings "My media" page can show ✓ deleted / ✗ live and re-verify on demand.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { storeLog } from '@/shared/lib/logger';
import { extractOwnedBlobs, type OwnedBlob } from '@/shared/lib/nostr/media/ownedBlobs';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

/** `deleted` is the only ✓ state; everything else renders ✗ on the media page. */
export type BlobDeleteState = 'live' | 'delete-requested' | 'deleted' | 'delete-failed';

export interface OwnedBlobEntry {
  sha256: string;
  url: string;
  host: string;
  mimeType?: string;
  /** Notes that referenced this blob (dedup set). */
  sourceNoteIds: string[];
  firstSeen: number;
  lastSeen: number;
  deleteState: BlobDeleteState;
  /** Last on-demand existence probe (ms), set by `markChecked`. */
  lastCheckedAt?: number;
}

interface OwnedMediaStore {
  bySha: Record<string, OwnedBlobEntry>;
  /** Upsert blobs; merges note ids + refreshes lastSeen, never downgrades deleteState. */
  recordBlobs: (blobs: OwnedBlob[], sourceNoteId?: string) => void;
  setDeleteState: (sha256: string, state: BlobDeleteState) => void;
  /** Fold an on-demand existence probe: gone → deleted; still-there after a
   *  delete attempt → delete-failed; a live blob stays live. */
  markChecked: (sha256: string, exists: boolean) => void;
}

const INITIAL: { bySha: Record<string, OwnedBlobEntry> } = { bySha: {} };

const PersistedEntry = z.looseObject({
  sha256: z.string().max(64),
  url: z.string().max(2048),
  host: z.string().max(512),
  mimeType: z.string().max(256).optional(),
  sourceNoteIds: z.array(z.string().max(128)).max(2000).default([]),
  firstSeen: z.number().int().nonnegative(),
  lastSeen: z.number().int().nonnegative(),
  deleteState: z.enum(['live', 'delete-requested', 'deleted', 'delete-failed']),
  lastCheckedAt: z.number().int().nonnegative().optional(),
});

const PersistedOwnedMediaStore = z.object({
  bySha: z.record(z.string().max(64), PersistedEntry).default({}),
});

export const useOwnedMediaStore = create<OwnedMediaStore>()(
  persist(
    (set) => ({
      ...INITIAL,

      recordBlobs: (blobs, sourceNoteId) => {
        if (blobs.length === 0) return;
        set((state) => {
          const now = Date.now();
          const bySha = { ...state.bySha };
          let added = 0;
          for (const blob of blobs) {
            const existing = bySha[blob.sha256];
            if (existing) {
              const sourceNoteIds =
                sourceNoteId && !existing.sourceNoteIds.includes(sourceNoteId)
                  ? [...existing.sourceNoteIds, sourceNoteId]
                  : existing.sourceNoteIds;
              bySha[blob.sha256] = {
                ...existing,
                // Prefer a known mime / url if we now have a richer one.
                url: blob.url || existing.url,
                mimeType: existing.mimeType ?? blob.mimeType,
                sourceNoteIds,
                lastSeen: now,
              };
            } else {
              added += 1;
              bySha[blob.sha256] = {
                sha256: blob.sha256,
                url: blob.url,
                host: blob.host,
                mimeType: blob.mimeType,
                sourceNoteIds: sourceNoteId ? [sourceNoteId] : [],
                firstSeen: now,
                lastSeen: now,
                deleteState: 'live',
              };
            }
          }
          if (added > 0) storeLog.info('ownedmedia.recorded', { added, total: blobs.length });
          return { bySha };
        });
      },

      setDeleteState: (sha256, deleteState) =>
        set((state) => {
          const cur = state.bySha[sha256];
          if (!cur) return state;
          storeLog.info('ownedmedia.delete_state', { sha256: sha256.slice(0, 12), deleteState });
          return { bySha: { ...state.bySha, [sha256]: { ...cur, deleteState } } };
        }),

      markChecked: (sha256, exists) =>
        set((state) => {
          const cur = state.bySha[sha256];
          if (!cur) return state;
          const deleteState: BlobDeleteState = exists
            ? cur.deleteState === 'live'
              ? 'live'
              : 'delete-failed'
            : 'deleted';
          storeLog.info('ownedmedia.check', { sha256: sha256.slice(0, 12), exists, deleteState });
          return {
            bySha: {
              ...state.bySha,
              [sha256]: { ...cur, deleteState, lastCheckedAt: Date.now() },
            },
          };
        }),
    }),
    persistConfig({
      name: 'owned-media-store',
      storage: createProfileScopedStorage(),
      schema: PersistedOwnedMediaStore,
      logKey: 'owned_media',
      partialize: (state) => ({ bySha: state.bySha }),
    })
  )
);

/**
 * Passive-ingest seam mirroring `ingestOwnContent`: record the blobs of any
 * own-authored kind:1 notes the app encounters (feed/thread/own-events sync),
 * so posts made on other clients with our key are captured too. No-op for
 * events that aren't ours.
 */
export function ingestOwnMediaBlobs(
  events: Iterable<FeedEvent>,
  viewerPubkey: string | undefined
): void {
  if (!viewerPubkey) return;
  const { recordBlobs } = useOwnedMediaStore.getState();
  for (const event of events) {
    if (event.kind !== 1 || event.pubkey !== viewerPubkey) continue;
    const blobs = extractOwnedBlobs(event);
    if (blobs.length > 0) recordBlobs(blobs, event.id);
  }
}

/** All owned blobs, newest-seen first — backs the settings "My media" page. */
export const selectOwnedBlobs = (state: OwnedMediaStore): OwnedBlobEntry[] =>
  Object.values(state.bySha).sort((a, b) => b.lastSeen - a.lastSeen);
