import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';

import { facade } from '@sovranbitcoin/nagg-ts';

import type {
  FeedEvent,
  NoteMetrics,
  ProfileInfo,
} from '@/features/feed/components/nostr/feedTypes';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import {
  NOSTR_METADATA_STALE_TTL_MS,
  cachedProfileToMetadata,
  type NostrProfileMetadata,
} from '@/shared/stores/global/nostrMetadataCache';

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

/**
 * The FULL cached profile record (name/displayName/picture/banner/nip05/lud16/
 * website/about) for a pubkey, read reactively from the single owner (the
 * nagg-ts entity cache). This is the seam the non-feed profile hooks
 * (`useCachedNostrProfile`, `useNostrProfileMetadata*`) read through, so every
 * surface — feed rows and DMs/contacts/signer alike — renders the same record.
 */
export function useProfileRecord(pubkey: string | undefined): facade.CachedProfile | undefined {
  const cache = buildNostrDataLayer()?.cache;
  return useCachedRecord(cache?.profiles, pubkey);
}

/**
 * Full cached profile records for many pubkeys, read reactively from the single
 * owner. Returns a referentially-stable Map that only changes when one of the
 * requested keys' records change or the requested set changes — safe for
 * `useSyncExternalStore` and cheap to depend on.
 */
export function useProfileRecordsMany(
  pubkeys: readonly string[]
): ReadonlyMap<string, facade.CachedProfile> {
  const store = buildNostrDataLayer()?.cache?.profiles;
  const stableKey = useMemo(() => [...pubkeys].sort().join(','), [pubkeys]);
  const versionRef = useRef(0);
  const snapRef = useRef<{
    key: string;
    version: number;
    map: ReadonlyMap<string, facade.CachedProfile>;
  } | null>(null);

  const subscribe = useCallback(
    (onChange: () => void) =>
      store
        ? store.subscribe(() => {
            versionRef.current += 1;
            onChange();
          })
        : NOOP_UNSUB,
    [store]
  );

  const getSnapshot = useCallback(() => {
    const cached = snapRef.current;
    if (cached && cached.key === stableKey && cached.version === versionRef.current) {
      return cached.map;
    }
    const map = new Map<string, facade.CachedProfile>();
    if (store) {
      for (const pk of pubkeys) {
        const record = store.get(pk);
        if (record) map.set(pk, record);
      }
    }
    snapRef.current = { key: stableKey, version: versionRef.current, map };
    return map;
    // pubkeys is captured via stableKey; rebuild only on key/version change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, stableKey]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Non-reactive read of one full profile record (for getState-style callers). */
export function readProfileRecord(pubkey: string): facade.CachedProfile | undefined {
  return buildNostrDataLayer()?.cache.getProfile(pubkey);
}

/**
 * Counterparty kind-0 for a pubkey, read from the single owner (entity cache)
 * and mapped to NostrProfileMetadata, with SWR staleness flags. The hub
 * `useNostrProfileMetadata` reads through this; a `seenAt: 0` (feed-seeded or
 * boot-seeded) record is "stale" so a real kind-0 fetch still runs.
 */
export function useCachedNostrProfile(pubkey: string): {
  metadata: NostrProfileMetadata | undefined;
  isStale: boolean;
  isMissing: boolean;
} {
  const record = useProfileRecord(pubkey || undefined);
  const metadata = useMemo(() => cachedProfileToMetadata(record), [record]);
  const isMissing = !metadata;
  const isStale = !!metadata && Date.now() - metadata.fetchedAt > NOSTR_METADATA_STALE_TTL_MS;
  return { metadata, isStale, isMissing };
}

/**
 * Write authoritative kind-0 metadata into the single owner (relay-fresh, so it
 * wins the merge and isn't immediately re-fetched). Use for resolved profiles
 * (own accounts, recipient resolution, recent-people, mock data).
 */
export function ingestResolvedProfiles(metadata: Record<string, facade.ProfileMetadata>): void {
  if (Object.keys(metadata).length === 0) return;
  buildNostrDataLayer()?.cache.ingestProfileMetadata(metadata, Date.now(), 'relay');
}

/**
 * Seed low-confidence name/picture into the single owner (seenAt 0 → fills gaps
 * only and stays "stale" so a real kind-0 fetch still runs). Use for search /
 * recommendation snapshots — a first-paint hint, not authority.
 */
export function seedLowConfidenceProfiles(
  infos: Record<string, { name?: string; picture?: string }>
): void {
  if (Object.keys(infos).length === 0) return;
  const normalized: Record<string, { name: string; picture?: string }> = {};
  for (const [pubkey, info] of Object.entries(infos)) {
    normalized[pubkey] = {
      name: info.name ?? '',
      ...(info.picture ? { picture: info.picture } : {}),
    };
  }
  buildNostrDataLayer()?.cache.ingestProfileInfos(normalized, 'cache');
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
