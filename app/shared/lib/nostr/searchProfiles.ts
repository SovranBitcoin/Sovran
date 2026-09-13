import * as nip19 from 'nostr-tools/nip19';
import { ok, err, type Result } from 'neverthrow';
import { facade } from 'nostr';
import type NDK from '@nostr-dev-kit/ndk-mobile';
import { refreshVertex } from '@/shared/lib/nostr/vertex/refreshVertex';
import { NostrSearchResult, type SearchUsersResponse } from '@sovranbitcoin/schemas';

import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';

// ---------------------------------------------------------------------------
// Profile search through the tier-selecting facade: nagg `/nostr/search`
// (Vertex-pagerank ranked, the gold path) → raw-relay NIP-50 floor. Returns the
// SAME `SearchUsersResponse` shape the old nagg-GraphQL `searchUsers` produced,
// so callers (useContactSearch + the split-bill picker) are unchanged. Which
// tiers run is gated by the Network settings toggles via buildNostrDataLayer.
// ---------------------------------------------------------------------------

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

/** The app's `SearchUsersResponse` from one facade answer (possibly partial). */
function responseFrom(
  resolved: facade.ResolvedProfileSearch,
  query: string,
  limit: number | undefined
): SearchUsersResponse {
  const results: NostrSearchResult[] = [];
  // Sort scored hits stably, leaving unknown-score slots in API order.
  const scored =
    resolved.tier === 'nagg'
      ? resolved.hits.filter((hit) => hit.score != null).sort((a, b) => b.score! - a.score!)
      : [];
  let scoredIndex = 0;
  const hits =
    resolved.tier === 'nagg'
      ? resolved.hits.map((hit) => (hit.score != null ? scored[scoredIndex++]! : hit))
      : resolved.hits;
  for (const hit of hits) {
    const mapped = hitToSearchResult(hit);
    if (mapped) results.push(mapped);
  }
  return {
    query,
    limit: limit ?? results.length,
    sort: `facade:${resolved.tier}`,
    results,
    fromCache: false,
  };
}

/**
 * Tier-selecting profile search. The facade fans out to every tier and paints
 * at the first answer; later tiers' hits are APPENDED and delivered through
 * `onUpdate`. A Vertex two-phase refresh follows when the answer was not a
 * fresh nagg one: the current answer is delivered through `onCached` first so
 * the UI paints, then the refreshed ranking replaces it. Exhaustion (every
 * tier disabled, failed or unreachable) is an ERROR, distinct from a healthy
 * empty answer (SYSTEM.md F06).
 */
export async function searchProfilesViaFacade(args: {
  query: string;
  limit?: number;
  signal?: AbortSignal;
  ndk?: NDK;
  /** Read-lifecycle correlation id, forwarded to the facade. */
  readId?: string;
  onCached?: (data: SearchUsersResponse) => void;
  /** A later tier's hits merged into the painted answer (append-only). */
  onUpdate?: (data: SearchUsersResponse) => void;
}): Promise<Result<SearchUsersResponse, Error>> {
  const layer = buildNostrDataLayer();
  if (!layer) return err(new Error('profile search disabled: no tiers enabled'));

  let result = await layer.searchProfiles({
    query: args.query,
    ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
    ...(args.signal ? { signal: args.signal } : {}),
    ...(args.readId ? { readId: args.readId } : {}),
    onUpdate: (resolved) => {
      if (args.signal?.aborted) return;
      args.onUpdate?.(responseFrom(resolved, args.query, args.limit));
    },
  });

  const toResponse = (): Result<SearchUsersResponse, Error> =>
    result.match(
      (resolved) => ok<SearchUsersResponse, Error>(responseFrom(resolved, args.query, args.limit)),
      (exhausted) =>
        err<SearchUsersResponse, Error>(
          new Error(`profile search unavailable: ${exhausted.message}`, { cause: exhausted })
        )
    );

  if (
    !args.signal?.aborted &&
    (result.isErr() || result.value.tier !== 'nagg' || result.value.vertexFresh !== true)
  ) {
    const cached = toResponse();
    if (cached.isOk()) args.onCached?.(cached.value);
    const refreshed = await refreshVertex({
      kind: 'search',
      query: args.query.trim().toLowerCase(),
      limit: args.limit ?? 10,
      stale: true,
      ndk: args.ndk,
      signal: args.signal,
    });
    if (refreshed && !args.signal?.aborted) {
      const hits = facade.searchHitsFromEnvelope(refreshed);
      if (hits.length) {
        // A DVM can know the score without having kind-0 metadata. Preserve
        // usable fallback names/pictures and results absent from its answer.
        const previous = new Map(
          result.isOk() ? result.value.hits.map((hit) => [hit.pubkey, hit]) : []
        );
        const merged = hits.map((hit) => {
          const cached = previous.get(hit.pubkey);
          previous.delete(hit.pubkey);
          return { ...cached, ...hit, metadata: { ...cached?.metadata, ...hit.metadata } };
        });
        result = ok({
          tier: 'nagg',
          vertexFresh: refreshed.vertexFresh,
          hits: [...merged, ...previous.values()].slice(0, args.limit ?? 10),
        });
      }
    }
  }

  return toResponse();
}
