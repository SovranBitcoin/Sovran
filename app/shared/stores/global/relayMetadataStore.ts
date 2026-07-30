/**
 * Per-relay NIP-11 metadata cache — the persisted SWR sibling of
 * `mintMetadataStore` (see that file for the pattern rationale), keyed by
 * normalized relay URL.
 *
 * Single-writer FETCH cache: the only writers are the SWR path below
 * (`getCachedRelayInfo` → `setInfo`/`setFailed`). Readers are the feed's
 * RelayCard (`useRelayMetadata`) and the composer's merged content limit
 * (`getMergedContentLimit`). A `failedAt` stamp negative-caches unreachable
 * relays so a dead host named in a viral post isn't re-fetched on every
 * scroll pass.
 *
 * Host-scoped (the same relay serves the same document to everyone) → bare
 * `AsyncStorage`, matching `mintMetadataStore`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo } from 'react';
import { z } from 'zod';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { storeLog } from '@/shared/lib/logger';
import {
  fetchRelayInformation,
  RelayInformationSchema,
  type RelayInformation,
} from '@/shared/lib/nostr/nip11';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

const MAX_ENTRIES = 200;
/** NIP-11 identity cadence — matches mint identity (24h). */
const INFO_TTL_MS = 24 * 60 * 60 * 1000;
/** Negative cache: an unreachable relay is retried at most every 10 minutes. */
const FAILURE_RETRY_MS = 10 * 60 * 1000;

/** Cache key: lowercased, trailing-slash-stripped relay url. Deliberately NOT
 *  the NDK normalizer (`safeNormalizeRelay`) — cache keys only need to be
 *  self-consistent, and the outbox module would drag NDK into every consumer
 *  of this store (and its tests). */
export function relayMetadataKey(relayUrl: string): string {
  return relayUrl.trim().toLowerCase().replace(/\/+$/, '');
}

interface RelayMetadataEntry {
  info?: RelayInformation;
  /** Last successful fetch — freshness stamp for SWR. */
  fetchedAt?: number;
  /** Last failed fetch — negative-cache stamp. */
  failedAt?: number;
}

const PersistedRelayMetadataEntry = z.looseObject({
  info: RelayInformationSchema.optional().catch(undefined),
  fetchedAt: z.number().int().nonnegative().optional().catch(undefined),
  failedAt: z.number().int().nonnegative().optional().catch(undefined),
});

const PersistedRelayMetadataStore = z.object({
  byRelayUrl: z.record(z.string().max(2048), PersistedRelayMetadataEntry).default({}),
});

interface RelayMetadataState {
  byRelayUrl: Record<string, RelayMetadataEntry>;

  getCached: (relayUrl: string) => RelayMetadataEntry | undefined;
  setInfo: (relayUrl: string, info: RelayInformation) => void;
  setFailed: (relayUrl: string) => void;
  clear: () => void;
}

/** Most-recent touch (success or failure) — drives LRU eviction. */
function lastTouched(entry: RelayMetadataEntry): number {
  return Math.max(entry.fetchedAt ?? 0, entry.failedAt ?? 0);
}

function evictIfOverCap(byRelayUrl: Record<string, RelayMetadataEntry>): void {
  const keys = Object.keys(byRelayUrl);
  if (keys.length <= MAX_ENTRIES) return;
  // Evict at least the overflow; round up to a 10% batch so steady-state
  // single-entry writes don't re-sort and trim one at a time at the boundary.
  const overflow = keys.length - MAX_ENTRIES;
  const evictCount = Math.max(overflow, Math.floor(MAX_ENTRIES * 0.1));
  const sorted = keys.sort((a, b) => lastTouched(byRelayUrl[a]) - lastTouched(byRelayUrl[b]));
  for (let i = 0; i < evictCount; i++) delete byRelayUrl[sorted[i]];
  storeLog.debug('store.relay_metadata.evicted', {
    evicted: evictCount,
    remaining: Object.keys(byRelayUrl).length,
  });
}

export const useRelayMetadataStore = create<RelayMetadataState>()(
  persist(
    (set, get) => ({
      byRelayUrl: {},

      getCached: (relayUrl) => get().byRelayUrl[relayMetadataKey(relayUrl)],

      setInfo: (relayUrl, info) => {
        const key = relayMetadataKey(relayUrl);
        set((state) => {
          const next = {
            ...state.byRelayUrl,
            // A success clears `failedAt` so `useRelayMetadata` can't report
            // `unreachable` for a relay that has since come back.
            [key]: { info, fetchedAt: Date.now() },
          };
          evictIfOverCap(next);
          return { byRelayUrl: next };
        });
      },

      setFailed: (relayUrl) => {
        const key = relayMetadataKey(relayUrl);
        set((state) => {
          const next = {
            ...state.byRelayUrl,
            // Keep any previously-fetched `info`: a stale document beats an
            // "unreachable" fallback when the relay is temporarily down.
            [key]: { ...state.byRelayUrl[key], failedAt: Date.now() },
          };
          evictIfOverCap(next);
          return { byRelayUrl: next };
        });
      },

      clear: () => {
        storeLog.info('store.relay_metadata.clear');
        set({ byRelayUrl: {} });
      },
    }),
    persistConfig({
      name: 'relay-metadata-store',
      storage: AsyncStorage,
      schema: PersistedRelayMetadataStore,
      logKey: 'relay_metadata',
      partialize: (state) => ({ byRelayUrl: state.byRelayUrl }),
    })
  )
);

// ---------------------------------------------------------------------------
// Cached NIP-11 fetch (SWR) — mirrors `getCachedMintInfo`. Never throws:
// failure resolves `undefined` (and stamps the negative cache).
// ---------------------------------------------------------------------------

/** Module-level promise dedupe so N cards for the same relay collapse to one HTTP fetch. */
const inflight = new Map<string, Promise<RelayInformation | undefined>>();

/**
 * SWR fetch:
 *   - cached + fresh          → resolve with the cached document
 *   - cached + stale          → resolve with the cached document, refresh in background
 *   - miss, recent failure    → resolve `undefined` without a network attempt
 *   - miss                    → await the fetch, write through
 */
export async function getCachedRelayInfo(relayUrl: string): Promise<RelayInformation | undefined> {
  const key = relayMetadataKey(relayUrl);
  const entry = useRelayMetadataStore.getState().byRelayUrl[key];
  const now = Date.now();

  if (entry?.info && typeof entry.fetchedAt === 'number') {
    if (now - entry.fetchedAt <= INFO_TTL_MS) {
      storeLog.debug('store.relay_metadata.info.hit_fresh', { key, ageMs: now - entry.fetchedAt });
      return entry.info;
    }
    storeLog.info('store.relay_metadata.info.hit_stale', { key });
    void fetchAndCache(relayUrl);
    return entry.info;
  }

  if (typeof entry?.failedAt === 'number' && now - entry.failedAt <= FAILURE_RETRY_MS) {
    storeLog.debug('store.relay_metadata.info.negative_hit', { key });
    return undefined;
  }

  storeLog.info('store.relay_metadata.info.miss', { key });
  return fetchAndCache(relayUrl);
}

function fetchAndCache(relayUrl: string): Promise<RelayInformation | undefined> {
  const key = relayMetadataKey(relayUrl);
  const existing = inflight.get(key);
  if (existing) return existing;

  const p = (async () => {
    try {
      const result = await fetchRelayInformation(relayUrl);
      if (result.isOk()) {
        useRelayMetadataStore.getState().setInfo(relayUrl, result.value);
        storeLog.info('store.relay_metadata.info.fetch_success', {
          key,
          hasName: typeof result.value.name === 'string' && result.value.name.length > 0,
        });
        return result.value;
      }
      // fetchRelayInformation already logged the network warning.
      useRelayMetadataStore.getState().setFailed(relayUrl);
      storeLog.warn('store.relay_metadata.info.fetch_failed', { key, reason: result.error.type });
      return undefined;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Fire-and-forget SWR revalidation — the mount hook below. No-ops when fresh,
 *  in-flight, or inside the failure-retry window. */
function revalidateRelayInfo(relayUrl: string): void {
  void getCachedRelayInfo(relayUrl);
}

/**
 * Selector hook + mount-triggered SWR — the RelayCard API. `status` is
 * `loading` until the first fetch settles, then `loaded` (document available,
 * possibly stale-while-revalidating) or `unreachable` (no document, recent
 * failure).
 */
export function useRelayMetadata(relayUrl: string): {
  entry: RelayMetadataEntry | undefined;
  status: 'loading' | 'loaded' | 'unreachable';
} {
  const key = useMemo(() => relayMetadataKey(relayUrl), [relayUrl]);
  const entry = useRelayMetadataStore((s) => s.byRelayUrl[key]);
  useEffect(() => {
    revalidateRelayInfo(relayUrl);
  }, [relayUrl]);
  const status = entry?.info ? 'loaded' : entry?.failedAt ? 'unreachable' : 'loading';
  return { entry, status };
}

/**
 * The tightest `max_content_length` across the given relays (the composer must
 * respect the strictest write relay). Returns `undefined` when no relay
 * advertises a limit, so callers apply a sane default. Re-homed from `nip11.ts`
 * when the cache moved here — a cache-consuming aggregate, not a fetcher.
 */
export async function getMergedContentLimit(
  relayUrls: readonly string[]
): Promise<number | undefined> {
  const infos = await Promise.all(relayUrls.map((url) => getCachedRelayInfo(url)));
  let min: number | undefined;
  for (const info of infos) {
    const limit = info?.limitation?.max_content_length;
    if (typeof limit === 'number' && limit > 0)
      min = min === undefined ? limit : Math.min(min, limit);
  }
  return min;
}
