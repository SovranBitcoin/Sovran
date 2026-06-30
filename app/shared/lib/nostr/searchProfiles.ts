import { nip19 } from 'nostr-tools';
import { ok, type Result } from 'neverthrow';
import type { facade } from 'nostr';
import { NostrSearchResult, type SearchUsersResponse } from '@sovranbitcoin/schemas';

import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';

// ---------------------------------------------------------------------------
// Profile search through the tier-selecting facade: nagg `/nostr/search`
// (Vertex-pagerank ranked, the gold path) → raw-relay NIP-50 floor. Returns the
// SAME `SearchUsersResponse` shape the old nagg-GraphQL `searchUsers` produced,
// so callers (useContactSearch + the split-bill picker) are unchanged. Which
// tiers run is gated by the Network settings toggles via buildNostrDataLayer.
// ---------------------------------------------------------------------------

const EMPTY: SearchUsersResponse = {
  query: '',
  limit: 0,
  sort: 'facade',
  results: [],
  fromCache: false,
};

/** Derive a bech32 npub, preferring the tier-supplied one; null if underivable. */
function resolveNpub(hit: facade.ProfileSearchHit): string | null {
  if (hit.npub) return hit.npub;
  try {
    return nip19.npubEncode(hit.pubkey);
  } catch {
    return null;
  }
}

function hitToSearchResult(hit: facade.ProfileSearchHit): NostrSearchResult | null {
  const npub = resolveNpub(hit);
  if (!npub) return null;
  const m = hit.metadata;
  // Per-hit parse bounds untrusted relay kind-0 content (field max-lengths,
  // Hex64 pubkey) — a single oversized field drops just that hit, not the set.
  const parsed = NostrSearchResult.safeParse({
    pubkey: hit.pubkey,
    npub,
    ...(typeof hit.rank === 'number' ? { rank: hit.rank } : {}),
    ...(hit.score != null ? { score: hit.score } : {}),
    ...(m.name ? { name: m.name } : {}),
    ...(m.displayName ? { displayName: m.displayName } : {}),
    ...(m.picture ? { picture: m.picture } : {}),
    ...(m.banner ? { banner: m.banner } : {}),
    ...(m.about ? { about: m.about } : {}),
    ...(m.nip05 ? { nip05: m.nip05 } : {}),
    ...(m.website ? { website: m.website } : {}),
    ...(m.lud16 ? { lud16: m.lud16 } : {}),
    ...(hit.followers != null ? { followers: hit.followers } : {}),
    ...(hit.follows != null ? { follows: hit.follows } : {}),
  });
  return parsed.success ? parsed.data : null;
}

export async function searchProfilesViaFacade(args: {
  query: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<Result<SearchUsersResponse, Error>> {
  const layer = buildNostrDataLayer();
  if (!layer) return ok({ ...EMPTY, query: args.query });

  const result = await layer.searchProfiles({
    query: args.query,
    ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
    ...(args.signal ? { signal: args.signal } : {}),
  });

  // Exhaustion (every tier disabled/failed/no-match) is an empty answer, not an
  // error — the search UI shows "no results" rather than a failure toast.
  return result.match(
    (resolved) => {
      const results: NostrSearchResult[] = [];
      for (const hit of resolved.hits) {
        const mapped = hitToSearchResult(hit);
        if (mapped) results.push(mapped);
      }
      return ok<SearchUsersResponse, Error>({
        query: args.query,
        limit: args.limit ?? results.length,
        sort: `facade:${resolved.tier}`,
        results,
        fromCache: false,
      });
    },
    () => ok<SearchUsersResponse, Error>({ ...EMPTY, query: args.query })
  );
}
