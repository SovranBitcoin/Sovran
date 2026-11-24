/**
 * What each mint has published about itself (NUT-06 `/v1/info`), as this
 * phone saw it change. Replaces nagg's changelog, which no longer exists
 * (ADR 0036).
 *
 * Per mint, by normalized URL: ONE canonical snapshot (the latest, the
 * `baseline`), when it was first and last seen, the check bookkeeping the
 * background sweep runs on, and at most `MAX_REVISIONS` revisions, newest
 * first. A revision holds the invertible RFC 6902 patch from the document
 * before it, so walking `invertPatch` back from the baseline rebuilds any
 * earlier version.
 *
 * Bounds (all held by the writer; the reader takes what an older build
 * wrote): `MAX_MINTS` mints, least recently viewed dropped first but the
 * wallet's own mints only after every other one; `MAX_REVISIONS` revisions; a
 * snapshot over `MAX_SNAPSHOT_BYTES` is not kept; a patch over
 * `MAX_PATCH_BYTES` is kept as an empty patch marked `oversized`; and the
 * whole row is held under `MAX_TOTAL_BYTES`, well inside Android's 2 MB row.
 *
 * Per profile: which mints a person looks at is theirs. Writers that run in
 * the background go through `mintHistorySync`, which waits for this store's
 * load and checks the profile has not changed after every `await`.
 */
import { defineStore as create } from '@/shared/lib/persist/defineStore';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

import {
  diffMintInfo,
  hashMintInfo,
  type CanonicalMintInfo,
} from '@/features/mint/lib/mintChanges/localDiff';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { tolerantArray, tolerantRecord } from '@/shared/lib/persist/tolerant';
import { normalizeMintUrlKey } from '@/shared/lib/url';

export const MAX_MINTS = 64;
export const MAX_REVISIONS = 20;
const MAX_SNAPSHOT_BYTES = 32_000;
const MAX_PATCH_BYTES = 8_000;
const MAX_TOTAL_BYTES = 1_000_000;
/** A check that finds the same document is saved at most this often. */
export const SEEN_WRITE_THROTTLE_MS = 60 * 60 * 1000;
/** A mint is checked again this long after a successful check. */
export const RECHECK_AFTER_SUCCESS_MS = 24 * 60 * 60 * 1000;
const BACKOFF_MIN_MS = 5 * 60 * 1000;
const BACKOFF_MAX_MS = 24 * 60 * 60 * 1000;
/** Opening a mint's history moves it up the eviction order at most this often. */
const VIEW_WRITE_THROTTLE_MS = 60 * 1000;

interface MintHistoryPatchOp {
  op: string;
  path: string;
  value?: unknown;
}

export interface MintHistoryRevision {
  /** Unique per revision, so A → B → A is two revisions with two ids. */
  id: string;
  /** Epoch ms of the check that saw the new document. */
  at: number;
  /** Epoch ms the old document was last seen: the change happened in between. */
  previousLastSeenAt?: number;
  /** Hash of the document this revision produced. */
  hash: string;
  patch: MintHistoryPatchOp[];
  /** The patch was too large to keep; the revision is known, not its detail. */
  oversized?: boolean;
}

export interface MintHistoryEntry {
  /** The URL as first seen, for display. */
  mintUrl: string;
  baseline?: CanonicalMintInfo;
  hash?: string;
  firstSeenAt?: number;
  lastSeenAt?: number;
  lastCheckedAt?: number;
  consecutiveFailures: number;
  nextRetryAt?: number;
  lastViewedAt?: number;
  /** A mint in the wallet: evicted only after every other mint. */
  trusted?: boolean;
  /** Newest first. */
  revisions: MintHistoryRevision[];
}

export type MintObservationOutcome = 'baseline' | 'changed' | 'unchanged' | 'rejected';

interface MintHistoryState {
  byMintUrl: Record<string, MintHistoryEntry>;
  recordObservation: (
    mintUrl: string,
    info: CanonicalMintInfo,
    nowMs?: number
  ) => MintObservationOutcome;
  recordFailure: (mintUrl: string, nowMs?: number, random?: () => number) => void;
  markViewed: (mintUrl: string, nowMs?: number) => void;
  /** Which mints are in the wallet; the only ones the sweep checks and eviction spares. */
  setTrustedMints: (mintUrls: readonly string[]) => void;
  clear: () => void;
}

const Timestamp = z.number().int().nonnegative();

const PersistedPatchOp = z.looseObject({
  op: z.string().max(16),
  path: z.string().max(1024),
  value: z.unknown().optional(),
});

const PersistedRevision = z.object({
  id: z.string().max(128),
  at: Timestamp,
  previousLastSeenAt: Timestamp.optional().catch(undefined),
  hash: z.string().max(128),
  patch: z.array(PersistedPatchOp).max(2000).catch([]),
  oversized: z.boolean().optional().catch(undefined),
});

const PersistedEntry = z.object({
  mintUrl: z.string().max(2048),
  baseline: z.record(z.string(), z.unknown()).optional().catch(undefined),
  hash: z.string().max(128).optional().catch(undefined),
  firstSeenAt: Timestamp.optional().catch(undefined),
  lastSeenAt: Timestamp.optional().catch(undefined),
  lastCheckedAt: Timestamp.optional().catch(undefined),
  consecutiveFailures: z.number().int().nonnegative().default(0).catch(0),
  nextRetryAt: Timestamp.optional().catch(undefined),
  lastViewedAt: Timestamp.optional().catch(undefined),
  trusted: z.boolean().optional().catch(undefined),
  revisions: tolerantArray(PersistedRevision, 200).default([]).catch([]),
});

const PersistedMintHistoryStore = z.object({
  byMintUrl: tolerantRecord(z.string().max(2048), PersistedEntry),
});

const byteLength = (value: unknown): number => {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

/** A revision id: short, and different for every (from, to, when). */
function revisionId(fromHash: string | undefined, toHash: string, at: number): string {
  return `${at.toString(36)}-${(fromHash ?? 'none').slice(0, 8)}-${toHash.slice(0, 12)}`;
}

/** 5 minutes doubling to 24 hours, ±20%, so a fleet of phones does not retry in step. */
export function failureBackoffMs(consecutiveFailures: number, random: () => number): number {
  const base = Math.min(
    BACKOFF_MAX_MS,
    BACKOFF_MIN_MS * 2 ** Math.max(0, Math.min(consecutiveFailures - 1, 20))
  );
  const jitter = 0.8 + random() * 0.4;
  return Math.round(Math.min(BACKOFF_MAX_MS, base * jitter));
}

const recency = (entry: MintHistoryEntry) =>
  Math.max(entry.lastViewedAt ?? 0, entry.lastSeenAt ?? 0, entry.lastCheckedAt ?? 0);

/** Drop untrusted mints, least recent first, then trusted ones, until within bounds. */
function evict(byMintUrl: Record<string, MintHistoryEntry>, keep: string): void {
  const over = () =>
    Object.keys(byMintUrl).length > MAX_MINTS || byteLength(byMintUrl) > MAX_TOTAL_BYTES;
  if (!over()) return;
  const order = Object.entries(byMintUrl)
    .filter(([key]) => key !== keep)
    .sort(([, a], [, b]) => Number(!!a.trusted) - Number(!!b.trusted) || recency(a) - recency(b))
    .map(([key]) => key);
  let dropped = 0;
  for (const key of order) {
    if (!over()) break;
    delete byMintUrl[key];
    dropped += 1;
  }
  if (dropped > 0) storeLog.debug('store.mint_history.evicted', { dropped });
}

function blank(mintUrl: string): MintHistoryEntry {
  return { mintUrl, consecutiveFailures: 0, revisions: [] };
}

export const useMintHistoryStore = create<MintHistoryState>({
  name: 'mint-history-store',
  scope: 'profile',
})(
  persist(
    (set, get) => ({
      byMintUrl: {},

      recordObservation: (mintUrl, info, nowMs = Date.now()) => {
        const key = normalizeMintUrlKey(mintUrl);
        if (!key) return 'rejected';
        if (byteLength(info) > MAX_SNAPSHOT_BYTES) {
          storeLog.warn('store.mint_history.snapshot_too_large', { bytes: byteLength(info) });
          return 'rejected';
        }
        const hash = hashMintInfo(info);
        const held = get().byMintUrl[key];

        if (held?.baseline && held.hash === hash) {
          const due =
            held.consecutiveFailures > 0 ||
            held.lastSeenAt === undefined ||
            nowMs - held.lastSeenAt >= SEEN_WRITE_THROTTLE_MS;
          if (!due) return 'unchanged';
          set((state) => {
            const current = state.byMintUrl[key];
            if (!current) return state;
            return {
              byMintUrl: {
                ...state.byMintUrl,
                [key]: {
                  ...current,
                  lastSeenAt: nowMs,
                  lastCheckedAt: nowMs,
                  consecutiveFailures: 0,
                  nextRetryAt: nowMs + RECHECK_AFTER_SUCCESS_MS,
                },
              },
            };
          });
          return 'unchanged';
        }

        let outcome: MintObservationOutcome = 'baseline';
        set((state) => {
          const current = state.byMintUrl[key] ?? blank(mintUrl);
          const next: MintHistoryEntry = {
            ...current,
            baseline: info,
            hash,
            firstSeenAt: current.firstSeenAt ?? nowMs,
            lastSeenAt: nowMs,
            lastCheckedAt: nowMs,
            consecutiveFailures: 0,
            nextRetryAt: nowMs + RECHECK_AFTER_SUCCESS_MS,
          };
          // The first sighting is a baseline, never a diff against nothing.
          if (current.baseline && current.hash !== hash) {
            outcome = 'changed';
            const patch = diffMintInfo(current.baseline, info);
            const oversized = byteLength(patch) > MAX_PATCH_BYTES;
            const revision: MintHistoryRevision = {
              id: revisionId(current.hash, hash, nowMs),
              at: nowMs,
              ...(current.lastSeenAt !== undefined
                ? { previousLastSeenAt: current.lastSeenAt }
                : {}),
              hash,
              patch: oversized ? [] : patch,
              ...(oversized ? { oversized: true } : {}),
            };
            next.revisions = [revision, ...current.revisions].slice(0, MAX_REVISIONS);
          }
          const byMintUrl = { ...state.byMintUrl, [key]: next };
          evict(byMintUrl, key);
          return { byMintUrl };
        });
        storeLog.info('store.mint_history.observed', { outcome });
        return outcome;
      },

      recordFailure: (mintUrl, nowMs = Date.now(), random = Math.random) => {
        const key = normalizeMintUrlKey(mintUrl);
        if (!key) return;
        set((state) => {
          const current = state.byMintUrl[key] ?? blank(mintUrl);
          const failures = current.consecutiveFailures + 1;
          const byMintUrl = {
            ...state.byMintUrl,
            // The baseline and its revisions stand: a mint that did not
            // answer has not changed what it last said.
            [key]: {
              ...current,
              lastCheckedAt: nowMs,
              consecutiveFailures: failures,
              nextRetryAt: nowMs + failureBackoffMs(failures, random),
            },
          };
          evict(byMintUrl, key);
          return { byMintUrl };
        });
      },

      markViewed: (mintUrl, nowMs = Date.now()) => {
        const key = normalizeMintUrlKey(mintUrl);
        const current = get().byMintUrl[key];
        if (!current) return;
        if (
          current.lastViewedAt !== undefined &&
          nowMs - current.lastViewedAt < VIEW_WRITE_THROTTLE_MS
        ) {
          return;
        }
        set((state) => ({
          byMintUrl: { ...state.byMintUrl, [key]: { ...current, lastViewedAt: nowMs } },
        }));
      },

      setTrustedMints: (mintUrls) => {
        const trusted = new Set(mintUrls.map((url) => normalizeMintUrlKey(url)));
        const held = get().byMintUrl;
        const changed = Object.entries(held).some(
          ([key, entry]) => !!entry.trusted !== trusted.has(key)
        );
        if (!changed) return;
        set((state) => ({
          byMintUrl: Object.fromEntries(
            Object.entries(state.byMintUrl).map(([key, entry]) => {
              const isTrusted = trusted.has(key);
              if (isTrusted) return [key, { ...entry, trusted: true }];
              const { trusted: _dropped, ...rest } = entry;
              return [key, rest];
            })
          ),
        }));
      },

      clear: () => set({ byMintUrl: {} }),
    }),
    persistConfig({
      name: 'mint-history-store',
      storage: createProfileScopedStorage(),
      schema: PersistedMintHistoryStore,
      logKey: 'mint_history',
      partialize: (state) => ({ byMintUrl: state.byMintUrl }),
    })
  )
);
