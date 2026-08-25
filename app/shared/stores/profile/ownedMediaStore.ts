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
 * verify. Keyed by `host|sha256`: the sha dedups the same bytes across URLs and
 * clients, but the host is part of the key because the same bytes uploaded to
 * two Blossom servers are two independent blobs — deleting from one must not
 * mark the copy on the other as gone (deleteState is per-host).
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
import { tolerantRecord } from '@/shared/lib/persist/tolerant';

/** `deleted` is the only ✓ state; everything else renders ✗ on the media page. */
export type BlobDeleteState = 'live' | 'delete-requested' | 'deleted' | 'delete-failed';

/** Ledger key: a blob is identified by the host it lives on AND its content hash. */
function blobKey(host: string, sha256: string): string {
  return `${host}|${sha256}`;
}

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
  byBlob: Record<string, OwnedBlobEntry>;
  /** Upsert blobs; merges note ids + refreshes lastSeen, never downgrades deleteState. */
  recordBlobs: (blobs: OwnedBlob[], sourceNoteId?: string) => void;
  setDeleteState: (host: string, sha256: string, state: BlobDeleteState) => void;
  /** Fold an on-demand existence probe: gone → deleted; still-there after a
   *  delete attempt → delete-failed; a live blob stays live. */
  markChecked: (host: string, sha256: string, exists: boolean) => void;
}

const INITIAL: { byBlob: Record<string, OwnedBlobEntry> } = { byBlob: {} };

const PersistedEntry = z.looseObject({
  sha256: z.string().max(64),
  url: z.string().max(2048),
  host: z.string().max(512),
  mimeType: z.string().max(256).optional(),
  sourceNoteIds: z.array(z.string().max(128)).max(2000).default([]),
  firstSeen: z.number().int().nonnegative(),
  lastSeen: z.number().int().nonnegative(),
  // Deliberately bare: `deleteState` encodes deletion intent — catching an
  // unknown state to 'live' resurfaces media the user may have deleted. The
  // per-entry safeParse below drops just the bad row; a genuinely live blob
  // is re-recorded by `recordBlobs` the next time it's seen in an own post.
  // ast-grep-ignore: persisted-enum-needs-catch
  deleteState: z.enum(['live', 'delete-requested', 'deleted', 'delete-failed']),
  lastCheckedAt: z.number().int().nonnegative().optional(),
});

const PersistedOwnedMediaStore = z.object({
  // An entry with an unrecognized `deleteState` (written by a newer build) is
  // dropped alone instead of failing the whole-blob parse, which would
  // discard the entire ownership ledger.
  byBlob: tolerantRecord(z.string().max(600), PersistedEntry),
});

export const useOwnedMediaStore = create<OwnedMediaStore>()(
  persist(
    (set) => ({
      ...INITIAL,

      recordBlobs: (blobs, sourceNoteId) => {
        if (blobs.length === 0) return;
        set((state) => {
          const now = Date.now();
          const byBlob = { ...state.byBlob };
          let added = 0;
          for (const blob of blobs) {
            const key = blobKey(blob.host, blob.sha256);
            const existing = byBlob[key];
            if (existing) {
              const sourceNoteIds =
                sourceNoteId && !existing.sourceNoteIds.includes(sourceNoteId)
                  ? [...existing.sourceNoteIds, sourceNoteId]
                  : existing.sourceNoteIds;
              byBlob[key] = {
                ...existing,
                // Prefer a known mime / url if we now have a richer one.
                url: blob.url || existing.url,
                mimeType: existing.mimeType ?? blob.mimeType,
                sourceNoteIds,
                lastSeen: now,
              };
            } else {
              added += 1;
              byBlob[key] = {
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
          return { byBlob };
        });
      },

      setDeleteState: (host, sha256, deleteState) =>
        set((state) => {
          const key = blobKey(host, sha256);
          const cur = state.byBlob[key];
          if (!cur) return state;
          storeLog.info('ownedmedia.delete_state', { sha256: sha256.slice(0, 12), deleteState });
          return { byBlob: { ...state.byBlob, [key]: { ...cur, deleteState } } };
        }),

      markChecked: (host, sha256, exists) =>
        set((state) => {
          const key = blobKey(host, sha256);
          const cur = state.byBlob[key];
          if (!cur) return state;
          const deleteState: BlobDeleteState = exists
            ? cur.deleteState === 'live'
              ? 'live'
              : 'delete-failed'
            : 'deleted';
          storeLog.info('ownedmedia.check', { sha256: sha256.slice(0, 12), exists, deleteState });
          return {
            byBlob: {
              ...state.byBlob,
              [key]: { ...cur, deleteState, lastCheckedAt: Date.now() },
            },
          };
        }),
    }),
    persistConfig({
      name: 'owned-media-store',
      storage: createProfileScopedStorage(),
      schema: PersistedOwnedMediaStore,
      logKey: 'owned_media',
      partialize: (state) => ({ byBlob: state.byBlob }),
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
  Object.values(state.byBlob).sort((a, b) => b.lastSeen - a.lastSeen);
