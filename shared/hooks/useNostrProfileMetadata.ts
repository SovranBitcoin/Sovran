import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Kind0MetadataSchema,
  useCachedNostrProfile,
  useNostrMetadataCache,
  type NostrProfileMetadata,
} from '@/shared/stores/global/nostrMetadataCache';
import { fetchProfilesViaFacade } from '@/shared/lib/nostr/fetchProfiles';

const STALE_TTL_MS = 24 * 60 * 60 * 1000;

interface UseNostrProfileMetadataResult {
  metadata: NostrProfileMetadata | undefined;
  isLoading: boolean;
}

const MAX_FETCH_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 4_000;

export function useNostrProfileMetadata(pubkey: string | undefined): UseNostrProfileMetadataResult {
  const setProfile = useNostrMetadataCache((s) => s.setProfile);
  const { metadata, isStale, isMissing } = useCachedNostrProfile(pubkey ?? '');
  const [isFetching, setIsFetching] = useState(false);

  // Per-pubkey attempt counter, capped at MAX_FETCH_ATTEMPTS. A facade fetch can
  // come back empty for a TRANSIENT reason (a tier was momentarily down / the
  // cache hadn't warmed). The old code marked the pubkey done after ONE such miss
  // and never retried, so kind-0 could stay missing forever. We now retry on a
  // short backoff a bounded number of times; a genuine not-found still settles
  // after the cap without looping.
  const attempts = useRef<Map<string, number>>(new Map());
  const [retryNonce, setRetryNonce] = useState(0);
  const attemptCount = pubkey ? (attempts.current.get(pubkey) ?? 0) : MAX_FETCH_ATTEMPTS;
  const needsFetch = !!pubkey && (isMissing || isStale) && attemptCount < MAX_FETCH_ATTEMPTS;

  useEffect(() => {
    if (!pubkey || !needsFetch) return;
    attempts.current.set(pubkey, (attempts.current.get(pubkey) ?? 0) + 1);
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    setIsFetching(true);
    void fetchProfilesViaFacade([pubkey])
      .then((profiles) => {
        if (cancelled) return;
        const found = profiles[pubkey];
        if (found) {
          attempts.current.set(pubkey, MAX_FETCH_ATTEMPTS); // resolved → stop retrying
          setProfile(pubkey, found);
          return;
        }
        // Nothing resolved this round — schedule a bounded retry.
        retryTimer = setTimeout(() => {
          if (!cancelled) setRetryNonce((n) => n + 1);
        }, RETRY_BACKOFF_MS);
      })
      .finally(() => {
        if (!cancelled) setIsFetching(false);
      });
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // retryNonce drives the bounded retry: bumping it re-runs the effect, which
    // re-reads the (now-incremented) attempt count through `needsFetch`.
  }, [pubkey, needsFetch, retryNonce, setProfile]);

  const isLoading = isMissing && isFetching;
  return { metadata, isLoading };
}

/**
 * Parse a raw kind-0 `content` JSON string into the cache's profile shape.
 * Exported so other surfaces (e.g. colada's `resolveRecipientProfile`
 * operation in `features/send/providers/Colada.tsx`) reuse the exact
 * same Zod schema + field-mapping as the hook — keeps `display_name` /
 * `displayName` aliasing and the rest of the metadata interpretation in one
 * place.
 */
export function parseRawMetadata(content: string): Omit<NostrProfileMetadata, 'fetchedAt'> | null {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return null;
  }
  const result = Kind0MetadataSchema.safeParse(json);
  if (!result.success) return null;
  const raw = result.data;
  return {
    displayName: raw.display_name ?? raw.displayName,
    name: raw.name,
    picture: raw.picture,
    banner: raw.banner,
    nip05: raw.nip05,
    lud16: raw.lud16,
    website: raw.website,
    about: raw.about,
  };
}

interface UseNostrProfileMetadataManyResult {
  /** Cached metadata for every pubkey we know about. Pubkeys still
   *  loading on first paint are absent from the map — callers can use
   *  `metadata.has(pubkey)` to drive loading skeletons. */
  metadata: ReadonlyMap<string, NostrProfileMetadata>;
  /** True while the initial fetch for any pubkey hasn't returned EOSE. */
  isLoading: boolean;
}

/**
 * SWR over many pubkeys at once. Backed by the same `nostrMetadataCache`
 * as the single-pubkey hook — populating one set of contacts warms the
 * cache for every other surface that consumes them (UserMessagesScreen,
 * UserProfileScreen, the picker, …). One batched kind-0 subscription
 * per render with `authors: missingOrStale` so we don't repeatedly hit
 * relays for entries we already have.
 */
export function useNostrProfileMetadataMany(
  pubkeys: readonly string[]
): UseNostrProfileMetadataManyResult {
  const setManyProfiles = useNostrMetadataCache((s) => s.setManyProfiles);
  const byPubkey = useNostrMetadataCache((s) => s.byPubkey);

  // Stable key from sorted pubkeys so a fresh array reference with
  // identical contents doesn't re-trigger memos / subscriptions.
  const stableKey = useMemo(() => [...pubkeys].sort().join(','), [pubkeys]);

  const metadata = useMemo(() => {
    const map = new Map<string, NostrProfileMetadata>();
    for (const pk of pubkeys) {
      const entry = byPubkey[pk];
      if (entry) map.set(pk, entry);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableKey, byPubkey]);

  // Pubkeys missing or stale in the cache and not yet attempted this lifetime.
  const attempted = useRef<Set<string>>(new Set());
  const toFetch = useMemo(() => {
    if (pubkeys.length === 0) return [];
    const now = Date.now();
    const out: string[] = [];
    for (const pk of pubkeys) {
      if (attempted.current.has(pk)) continue;
      const entry = byPubkey[pk];
      if (!entry || now - entry.fetchedAt > STALE_TTL_MS) out.push(pk);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableKey, byPubkey]);

  const [isFetching, setIsFetching] = useState(false);
  const toFetchKey = toFetch.join(',');
  useEffect(() => {
    if (toFetch.length === 0) return;
    for (const pk of toFetch) attempted.current.add(pk);
    let cancelled = false;
    setIsFetching(true);
    void fetchProfilesViaFacade(toFetch)
      .then((profiles) => {
        if (cancelled || Object.keys(profiles).length === 0) return;
        setManyProfiles(profiles);
      })
      .finally(() => {
        if (!cancelled) setIsFetching(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toFetchKey, setManyProfiles]);

  const isLoading = isFetching;
  return { metadata, isLoading };
}
