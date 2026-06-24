import { useMemo, useSyncExternalStore } from 'react';

import { facade } from '@sovranbitcoin/nagg-ts';

import type { ProfileInfo } from '@/features/feed/components/nostr/feedTypes';
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

type ProfileStatus = 'cached' | 'loading' | 'absent';

const NOOP_UNSUB = () => {};

function useCachedRecord<T>(
  store: facade.NormalizingStore<T> | undefined,
  key: string | undefined
): T | undefined {
  const subscribe = (onChange: () => void) =>
    store && key ? store.subscribeKey(key, onChange) : NOOP_UNSUB;
  const getSnapshot = () => (store && key ? store.get(key) : undefined);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function usePendingProfile(
  pending: facade.PendingSet | undefined,
  key: string | undefined
): boolean {
  const subscribe = (onChange: () => void) =>
    pending && key ? pending.subscribeKey(key, onChange) : NOOP_UNSUB;
  const getSnapshot = () => (pending && key ? pending.has(key) : false);
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
