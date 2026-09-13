/**
 * @fileoverview `useOverlaidContactSearch` — the canonical people-search assembly.
 *
 * Wraps `useContactSearch` (Nagg profile search via the facade) and overlays the
 * shared kind-0 metadata cache on top, so a search hit whose GraphQL row carries
 * only a pubkey still renders with cached name/picture/nip05/lud16 instead of a
 * fallback gradient + abbreviated pubkey.
 *
 * This is the SINGLE owner of that overlay. Both `useAllSearchResults` (the
 * wallet/feed "All" search) and the Send modal consume it, so their People
 * results and per-result metrics are identical — one implementation, two
 * consumers, no parallel copy.
 *
 * Unlike `useAllSearchResults`, it has NO location side-effect (that hook also
 * calls `useLocationTiers`, which requests foreground location on mount). So a
 * payment surface like Send can reuse the canonical people search without
 * acquiring a location permission it never uses.
 */

import { useMemo } from 'react';

import { useContactSearch } from '@/features/payments/hooks/useContactSearch';
import { useNostrProfileMetadataMany } from '@/shared/hooks/useNostrProfileMetadata';
import type { NostrSearchResult } from '@/shared/lib/apiClient';
import type { SearchStatus } from '@/shared/ui/composed/search/searchListState';

/**
 * One overlaid contact-search row. Structurally the `'contact'` arm of
 * `AllSearchResult` (which is defined as `ContactSearchRow`), so the shared union
 * has a single source of truth and callers access `pubkey`/`profile` without
 * narrowing a 4-arm union.
 */
export interface ContactSearchRow {
  type: 'contact';
  id: string;
  pubkey: string;
  profile?: NostrSearchResult;
  isLoadingProfile: boolean;
  score: number;
}

// Score base for contact rows. `useAllSearchResults` sorts the shared union
// against its geohash/tier scores using the `score` each row already carries.
const SCORE_CONTACT_BASE = 100;

export function useOverlaidContactSearch(query: string): {
  contactRows: ContactSearchRow[];
  loading: boolean;
  status: SearchStatus;
  retry: () => void;
} {
  const { results, searchLoading, status, retry } = useContactSearch(query);

  // The API row can be sparse (sometimes just a pubkey), so the shared kind-0
  // metadata cache is layered on top. Cache hits paint immediately; missing or
  // stale entries trigger a fetch.
  const pubkeys = useMemo(() => results.map((r) => r.pubkey), [results]);
  const { metadata: cachedMetadata } = useNostrProfileMetadataMany(pubkeys);

  const contactRows = useMemo<ContactSearchRow[]>(() => {
    // `isLoadingProfile` reflects whether *this row's* profile is absent — not
    // whether *some* query is in flight. Prior results stay visible during a
    // refinement (stale-while-revalidate), so flagging every row loading on
    // every keystroke would re-skeleton real results.
    return results.map((r, i) => {
      // Overlay relay-cached kind-0 metadata over the search snapshot: cache
      // values win when defined (they're authoritative), falling back to the
      // API row otherwise.
      const cached = cachedMetadata.get(r.pubkey);
      const profile: NostrSearchResult = cached
        ? {
            ...r.profile,
            displayName: cached.displayName ?? r.profile.displayName,
            name: cached.name ?? r.profile.name,
            picture: cached.picture ?? r.profile.picture,
            nip05: cached.nip05 ?? r.profile.nip05,
            banner: cached.banner ?? r.profile.banner,
            lud16: cached.lud16 ?? r.profile.lud16,
            about: cached.about ?? r.profile.about,
            website: cached.website ?? r.profile.website,
          }
        : r.profile;
      return {
        type: 'contact' as const,
        id: `contact:${r.pubkey}`,
        pubkey: r.pubkey,
        profile,
        isLoadingProfile: false,
        score: SCORE_CONTACT_BASE - i, // preserve order from API
      };
    });
  }, [results, cachedMetadata]);

  return { contactRows, loading: searchLoading, status, retry };
}
