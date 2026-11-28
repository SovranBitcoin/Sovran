import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';

import { facade } from 'nostr';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import { peekNostrDataLayer } from '@/shared/lib/nostr/dataLayerRegistry';
import {
  NOSTR_METADATA_STALE_TTL_MS,
  cachedProfileToMetadata,
  type NostrProfileMetadata,
} from '@/shared/stores/global/nostrMetadataCache';

// ---------------------------------------------------------------------------
// Reactive bindings over the authoritative entity cache of the `nostr` package.
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

/**
 * One key of one store. `peek`, not `get`: a snapshot is read on every render
 * of every row, and `get` re-inserts the key into the LRU map each time.
 * Subscribing is what marks the record as in use.
 */
function useCachedRecord<T>(
  store: facade.NormalizingStore<T> | undefined,
  key: string | undefined
): T | undefined {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!store || !key) return NOOP_UNSUB;
      store.get(key);
      return store.subscribeKey(key, onChange);
    },
    [store, key]
  );
  const getSnapshot = useCallback(() => (store && key ? store.peek(key) : undefined), [store, key]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** What one row needs to know about one profile, from one subscription. */
type ProfileEntry = {
  record: facade.CachedProfile | undefined;
  /** No usable record, or one past the staleness window, and no recent miss says not to ask. */
  needsFetch: boolean;
  /** The record is missing or stale and a fetch for it is owed or in flight: hold the placeholder rather than show a fallback. */
  isResolving: boolean;
};

const NO_ENTRY: ProfileEntry = { record: undefined, needsFetch: false, isResolving: false };

/**
 * A row's whole view of one pubkey: the record, and whether a fetch is still
 * owed or running. One `useSyncExternalStore` keyed by the pubkey, so a row
 * re-renders only when ITS profile or ITS fetch state changes, and the
 * snapshot keeps its identity while neither has: a fetch that starts and ends
 * without changing what the row shows costs it no render.
 */
function useProfileEntry(pubkey: string | undefined): ProfileEntry {
  const cache = buildNostrDataLayer()?.cache;
  const last = useRef<ProfileEntry>(NO_ENTRY);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!cache || !pubkey) return NOOP_UNSUB;
      cache.profiles.get(pubkey);
      const stops = [
        cache.profiles.subscribeKey(pubkey, onChange),
        cache.pendingProfiles.subscribeKey(pubkey, onChange),
        cache.profileMisses.subscribeKey(pubkey, onChange),
      ];
      return () => {
        for (const stop of stops) stop();
      };
    },
    [cache, pubkey]
  );
  const getSnapshot = useCallback(() => {
    if (!cache || !pubkey) return NO_ENTRY;
    const now = Date.now();
    const record = cache.profiles.peek(pubkey);
    const stale = !record || now - (record.fetchedAt ?? 0) > NOSTR_METADATA_STALE_TTL_MS;
    const needsFetch = stale && !cache.isProfileMissed(pubkey, now);
    // A refresh of a profile that is already fetched and fresh is not
    // "resolving": nothing the row shows is waiting on it.
    const isResolving = needsFetch || (stale && cache.pendingProfiles.has(pubkey));
    const previous = last.current;
    if (
      previous.record === record &&
      previous.needsFetch === needsFetch &&
      previous.isResolving === isResolving
    ) {
      return previous;
    }
    last.current = { record, needsFetch, isResolving };
    return last.current;
  }, [cache, pubkey]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * The cached profile header (counts, joined date, Vertex reputation, what the
 * pubkey operates) read reactively from the single owner. A row that was handed
 * a profile without a score reads the score another surface fetched from here,
 * so the figure never depends on which list the person was found in.
 */
export function useCachedProfileStats(
  pubkey: string | undefined
): facade.CachedProfileStats | undefined {
  // Peek, never build: this runs in every list row.
  const cache = peekNostrDataLayer()?.cache;
  return useCachedRecord(cache?.profileStats, pubkey);
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
    store: facade.NormalizingStore<facade.CachedProfile> | undefined;
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
    const sameScope = cached?.store === store && cached?.key === stableKey;
    if (cached && sameScope && cached.version === versionRef.current) {
      return cached.map;
    }
    // Keep the global subscription: LRU eviction notifies the store even when
    // only an unrelated key was written. But preserve our snapshot unless one
    // of the requested records actually changed, so feed ingestion does not
    // rerender every contact/profile consumer or re-map all their metadata.
    //
    // The first read of a scope uses `get`, so mounting a consumer marks its
    // profiles as recently used. Every re-check after that peeks: `get` would
    // re-insert each requested key into the LRU map on every unrelated write.
    let map = sameScope ? undefined : new Map<string, facade.CachedProfile>();
    for (const pk of pubkeys) {
      const record = sameScope ? store?.peek(pk) : store?.get(pk);
      if (!map && cached?.map.get(pk) !== record) map = new Map(cached?.map);
      if (map) {
        if (record) map.set(pk, record);
        else map.delete(pk);
      }
    }
    const snapshot = map ?? cached!.map;
    snapRef.current = { store, key: stableKey, version: versionRef.current, map: snapshot };
    return snapshot;
    // pubkeys is captured via stableKey; rebuild only on key/version change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, stableKey]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Remember settled misses across consumers, without subscribing rows to unrelated records. */
export function useProfileFetchSettlements(pubkeys: readonly string[]): ReadonlySet<string> {
  const store = buildNostrDataLayer()?.cache.settledProfiles;
  const key = pubkeys.join(',');
  const subscribe = useCallback(
    (onChange: () => void) => (store ? store.subscribe(onChange) : NOOP_UNSUB),
    [store]
  );
  const getSnapshot = useCallback(
    () =>
      key
        .split(',')
        .filter((pk) => store?.has(pk))
        .join(','),
    [store, key]
  );
  const settledKey = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useMemo(() => new Set(settledKey ? settledKey.split(',') : []), [settledKey]);
}

/** Non-reactive read of one full profile record (for getState-style callers). */
export function readProfileRecord(pubkey: string): facade.CachedProfile | undefined {
  return buildNostrDataLayer()?.cache.getProfile(pubkey);
}

/**
 * Counterparty kind-0 for a pubkey, read from the single owner (entity cache)
 * and mapped to NostrProfileMetadata, with the fetch state a row needs. The
 * hub `useNostrProfileMetadata` reads through this.
 *
 * - `isStale`: the record was never fetched (a seed) or is past the 24 h
 *   window; `isMissing`: there is no record at all.
 * - `needsFetch`: a fetch is owed for it (missing or stale, and no recent
 *   fetch already came back empty).
 * - `isResolving`: that fetch is owed or in flight.
 */
export function useCachedNostrProfile(pubkey: string): {
  metadata: NostrProfileMetadata | undefined;
  isStale: boolean;
  isMissing: boolean;
  needsFetch: boolean;
  isResolving: boolean;
} {
  const entry = useProfileEntry(pubkey || undefined);
  // Keyed on the record alone: a fetch starting or finishing without changing
  // the profile must not hand the row a new metadata object.
  const metadata = useMemo(() => cachedProfileToMetadata(entry.record), [entry.record]);
  return useMemo(
    () => ({
      metadata,
      isMissing: !metadata,
      isStale: !!metadata && Date.now() - metadata.fetchedAt > NOSTR_METADATA_STALE_TTL_MS,
      needsFetch: entry.needsFetch,
      isResolving: entry.isResolving,
    }),
    [metadata, entry]
  );
}

/** True while a recent fetch that found nothing says not to ask for this profile again yet. */
export function isProfileMissed(pubkey: string): boolean {
  return buildNostrDataLayer()?.cache.isProfileMissed(pubkey) ?? false;
}

/**
 * Write kind-0 metadata the app resolved itself (recipient resolution on Send,
 * the own-account refresh) into the single owner.
 *
 * `createdAt` is each profile's kind-0 `created_at` in unix SECONDS, and is
 * the merge order: the entry replaces an older cached profile, removals
 * included, and is replaced by any newer one fetched later. That ordering is
 * what stops Send paying a Lightning address the person has since removed.
 *
 * An entry without an event time (the app-view refresh carries none) ranks
 * above a seed and below every real event, and is not stamped as fetched, so
 * the real kind-0 is still fetched and then replaces it.
 */
export function ingestResolvedProfiles(
  metadata: Record<string, facade.ProfileMetadata>,
  createdAt: Readonly<Record<string, number | undefined>> = {}
): void {
  const pubkeys = Object.keys(metadata);
  if (pubkeys.length === 0) return;
  const fetchedAt: Record<string, number> = {};
  for (const pubkey of pubkeys) if (!createdAt[pubkey]) fetchedAt[pubkey] = 0;
  buildNostrDataLayer()?.cache.ingestProfileMetadata(metadata, 1, 'relay', {
    createdAt,
    fetchedAt,
  });
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
