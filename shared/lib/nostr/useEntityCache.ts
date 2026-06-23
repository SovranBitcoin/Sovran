import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { facade } from '@sovranbitcoin/nagg-ts';

import type {
  FeedEvent,
  NoteMetrics,
  ProfileInfo,
} from '@/features/feed/components/nostr/feedTypes';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';

// ---------------------------------------------------------------------------
// Reactive bindings over the authoritative nagg-ts entity cache.
//
// A row reads its author/profile/metrics straight from the singleton cache and
// re-renders ONLY when that specific key changes (subscribeKey) — so a feed-wide
// ingest doesn't churn unaffected rows, and a profile that arrives later fills
// in place with no manual re-keying. `get(key)` returns a stable reference for an
// unchanged record (writes are idempotent in the store), which is exactly what
// useSyncExternalStore needs to avoid render loops.
// ---------------------------------------------------------------------------

export type ProfileStatus = 'cached' | 'loading' | 'absent';

const NOOP_UNSUB = () => {};

function useCachedRecord<T>(
  store: facade.NormalizingStore<T> | undefined,
  key: string | undefined
): T | undefined {
  const subscribe = useCallback(
    (onChange: () => void) => (store && key ? store.subscribeKey(key, onChange) : NOOP_UNSUB),
    [store, key]
  );
  const getSnapshot = useCallback(() => (store && key ? store.get(key) : undefined), [store, key]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function usePendingProfile(
  pending: facade.PendingSet | undefined,
  key: string | undefined
): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => (pending && key ? pending.subscribeKey(key, onChange) : NOOP_UNSUB),
    [pending, key]
  );
  const getSnapshot = useCallback(
    () => (pending && key ? pending.has(key) : false),
    [pending, key]
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * The author profile for a pubkey, plus a status that distinguishes a real
 * cached record from a fetch-in-flight (skeleton) and a genuinely-absent profile
 * (fallback). Reads the per-active-profile singleton cache.
 */
export function useProfile(pubkey: string | undefined): {
  profile: ProfileInfo | undefined;
  status: ProfileStatus;
} {
  const cache = buildNostrDataLayer()?.cache;
  const record = useCachedRecord(cache?.profiles, pubkey);
  const pending = usePendingProfile(cache?.pendingProfiles, pubkey);
  return useMemo(() => {
    const profile: ProfileInfo | undefined = record
      ? { name: record.name ?? '', ...(record.picture ? { picture: record.picture } : {}) }
      : undefined;
    const status: ProfileStatus = record ? 'cached' : pending ? 'loading' : 'absent';
    return { profile, status };
  }, [record, pending]);
}

/** A cached note body by id (structurally a FeedEvent). */
export function useNote(id: string | undefined): FeedEvent | undefined {
  const cache = buildNostrDataLayer()?.cache;
  return useCachedRecord(cache?.notes, id);
}

/** Cached engagement metrics for a note id, mapped to the app's NoteMetrics shape. */
export function useNoteStats(id: string | undefined): NoteMetrics | undefined {
  const cache = buildNostrDataLayer()?.cache;
  const record = useCachedRecord(cache?.noteStats, id);
  return useMemo(
    () =>
      record
        ? {
            likeCount: record.likes,
            repostCount: record.reposts,
            replyCount: record.replies,
            satsZapped: record.satsZapped,
          }
        : undefined,
    [record]
  );
}
