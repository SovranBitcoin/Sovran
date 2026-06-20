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

export function useNostrProfileMetadata(pubkey: string | undefined): UseNostrProfileMetadataResult {
  const setProfile = useNostrMetadataCache((s) => s.setProfile);
  const { metadata, isStale, isMissing } = useCachedNostrProfile(pubkey ?? '');
  const [isFetching, setIsFetching] = useState(false);

  // Once a pubkey is attempted we don't re-fetch it for this hook's lifetime,
  // so a not-found profile (cache stays missing) can't loop the effect.
  const attempted = useRef<Set<string>>(new Set());
  const needsFetch = !!pubkey && (isMissing || isStale) && !attempted.current.has(pubkey);

  useEffect(() => {
    if (!pubkey || !needsFetch) return;
    attempted.current.add(pubkey);
    let cancelled = false;
    setIsFetching(true);
    void fetchProfilesViaFacade([pubkey])
      .then((profiles) => {
        if (cancelled) return;
        const found = profiles[pubkey];
        if (found) setProfile(pubkey, found);
      })
      .finally(() => {
        if (!cancelled) setIsFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pubkey, needsFetch, setProfile]);

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
