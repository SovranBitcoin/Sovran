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

/**
 * Rows already on screen for this search, in the order they were painted.
 * Every later answer for the same query (a slower tier, the Vertex refresh)
 * keeps those rows in place and appends only what is new: a list that
 * reorders or shrinks under the reader's eyes is the flicker this exists to
 * prevent. Ranking therefore decides order only for the FIRST paint.
 */
type PaintedOrder = Map<string, number>;

/** The app's `SearchUsersResponse` from one facade answer (possibly partial). */
function responseFrom(
  resolved: facade.ResolvedProfileSearch,
  query: string,
  limit: number | undefined,
  painted: PaintedOrder
): SearchUsersResponse {
  const results: NostrSearchResult[] = [];
  // Sort scored hits stably, leaving unknown-score slots in API order.
  const scored =
    resolved.tier === 'nagg'
      ? resolved.hits.filter((hit) => hit.score != null).sort((a, b) => b.score! - a.score!)
      : [];
  let scoredIndex = 0;
  const ranked =
    resolved.tier === 'nagg'
      ? resolved.hits.map((hit) => (hit.score != null ? scored[scoredIndex++]! : hit))
      : resolved.hits;
  // Painted rows first, in painted order; newcomers after, in ranked order.
  const kept = ranked
    .filter((hit) => painted.has(hit.pubkey))
    .sort((a, b) => painted.get(a.pubkey)! - painted.get(b.pubkey)!);
  const added = ranked.filter((hit) => !painted.has(hit.pubkey));
  for (const hit of [...kept, ...added]) {
    const mapped = hitToSearchResult(hit);
    if (!mapped) continue;
    results.push(mapped);
    if (!painted.has(mapped.pubkey)) painted.set(mapped.pubkey, painted.size);
  }
  return {
    query,
    limit: limit ?? results.length,
    sort: `facade:${resolved.tier}`,
    results,
    fromCache: false,
  };
}

/** `base` plus any hit of `extra` it lacks (append-only union by pubkey). */
function unionHits(
  base: readonly facade.ProfileSearchHit[],
  extra: readonly facade.ProfileSearchHit[]
): facade.ProfileSearchHit[] {
  const seen = new Set(base.map((hit) => hit.pubkey));
  return [...base, ...extra.filter((hit) => !seen.has(hit.pubkey))];
}

/**
 * Tier-selecting profile search. The facade fans out to every tier and paints
 * at the first answer; later tiers' hits are APPENDED and delivered through
 * `onUpdate`. A Vertex two-phase refresh follows when the answer was not a
 * fresh nagg one: the current answer is delivered through `onCached` first so
 * the UI paints, then the refreshed scores are merged in. Exhaustion (every
 * tier disabled, failed or unreachable) is an ERROR, distinct from a healthy
 * empty answer (SYSTEM.md F06).
 *
 * Every answer this emits for one call — partial, refreshed, final — is a
 * superset of the previous one in the same row order (see `PaintedOrder`):
 * the resolved value is the LATEST merged answer, never the first-paint
 * snapshot, so the final write can neither drop nor reorder rows a later
 * tier already painted.
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

  const painted: PaintedOrder = new Map();
  const emit = (resolved: facade.ResolvedProfileSearch): SearchUsersResponse =>
    responseFrom(resolved, args.query, args.limit, painted);
  // The most recent merged answer from the tiers. A slower tier can settle
  // between the facade resolving and this continuation running, so it is
  // tracked from the first update, not from the awaited value.
  const tiers: { latest: facade.ResolvedProfileSearch | null } = { latest: null };
  const first = await layer.searchProfiles({
    query: args.query,
    ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
    ...(args.signal ? { signal: args.signal } : {}),
    ...(args.readId ? { readId: args.readId } : {}),
    onUpdate: (resolved) => {
      if (args.signal?.aborted) return;
      tiers.latest = resolved;
      args.onUpdate?.(emit(resolved));
    },
  });
  let result = first.map((resolved) => tiers.latest ?? resolved);

  const toResponse = (): Result<SearchUsersResponse, Error> =>
    result.match(
      (resolved) =>
        ok<SearchUsersResponse, Error>(
          // A tier that settled during the Vertex refresh painted its rows
          // already; the final answer keeps them.
          emit(
            tiers.latest
              ? { ...resolved, hits: unionHits(resolved.hits, tiers.latest.hits) }
              : resolved
          )
        ),
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
        const known = result.isOk()
          ? unionHits(result.value.hits, tiers.latest?.hits ?? [])
          : (tiers.latest?.hits ?? []);
        const previous = new Map(known.map((hit) => [hit.pubkey, hit]));
        const merged = hits.map((hit) => {
          const cached = previous.get(hit.pubkey);
          previous.delete(hit.pubkey);
          return { ...cached, ...hit, metadata: { ...cached?.metadata, ...hit.metadata } };
        });
        // No `slice(limit)` here: a painted row must never be cut by a later
        // ranking; each tier already bounds its own answer by the limit.
        result = ok({
          tier: 'nagg',
          vertexFresh: refreshed.vertexFresh,
          hits: [...merged, ...previous.values()],
        });
      }
    }
  }

  return toResponse();
}
