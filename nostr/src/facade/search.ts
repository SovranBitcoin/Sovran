import type { SignedVertexRequest } from './vertex-request';
import type { NostrTier } from '@sovranbitcoin/schemas';
import {
  aggregateValue,
  profileMetadataByPubkey,
  type NaggProfilesEnvelope,
} from '../envelope';
import type { RequestControls } from '../timeout';
import type { ReadProvenance, TierOutcome } from '../tiers';
import { parseProfileMetadata, type ProfileMetadata } from './profiles';

// ---------------------------------------------------------------------------
// Search surface — profile (kind-0) full-text search.
//
// nagg owns the gold path: its `/nostr/search` app-view is Vertex-pagerank
// ranked, so the nagg tier carries `rank`/`score`/follower counts. The raw-relay
// floor is NIP-50 (`{ kinds:[0], search }`): functional where a relay advertises
// NIP-50, empty where it doesn't — the honest, unranked fallback. Primal exposes
// a user-search verb too, but its exact name isn't pinned yet, so the Primal tier
// declares search unsupported for now (it simply skips the surface).
//
// Note/content search is intentionally NOT here: nagg serves it only over
// GraphQL (the facade nagg tier is REST), and the app has no content-search
// surface to consume it. Add it when both exist.
// ---------------------------------------------------------------------------

export type ProfileSearchHit = {
  pubkey: string;
  /** Present from nagg; the relay floor leaves it for the caller to derive. */
  npub?: string;
  metadata: ProfileMetadata;
  /** Vertex / app-view ranking; null on the relay floor (no global rank). */
  vertexFetchedAt?: number | null;
  vertexFresh?: boolean | null;
  rank?: number | null;
  score?: number | null;
  followers?: number | null;
  follows?: number | null;
  /** What the pubkey operates, per nagg identities (absent on lower tiers). */
  operatesMints?: string[];
  operatesAiProviders?: string[];
};

export type SearchRequest = RequestControls & {
  signedVertexRequest?: SignedVertexRequest;
  query: string;
  limit?: number;
  refresh?: boolean;
  /**
   * Aggregate reads paint at the first-paint gate and keep merging: each later
   * tier's hits are APPENDED (never reordered) and delivered here. Also fires
   * once more at settle with `provenance.complete === true`.
   */
  onUpdate?: (resolved: ResolvedProfileSearch) => void;
};

export type ProfileSearchBundle = { hits: ProfileSearchHit[]; vertexFresh?: boolean | null };

export type ResolvedProfileSearch = ProfileSearchBundle & { tier: NostrTier; provenance?: ReadProvenance };

export interface SearchTier {
  readonly tier: NostrTier;
  searchProfiles(request: SearchRequest): Promise<TierOutcome<ProfileSearchBundle>>;
}

/**
 * Build the ranked hits from a v2 `/nostr/search` envelope. The `pubkeys` list
 * is the COMPLETE ranked result (it includes profiles nagg has no local kind-0
 * for — those hits carry empty metadata); rank/score come from the `providers`
 * map (`providers[pk].vertex`), follower/following counts from the pubkey-keyed
 * aggregates. Zero-omitted aggregates map to null (unknown), matching v1's
 * nullable counts. v2 carries no `npub` — callers derive it when needed.
 */
export function searchHitsFromEnvelope(envelope: NaggProfilesEnvelope): ProfileSearchHit[] {
  const metadataByPubkey = profileMetadataByPubkey(envelope);
  const ranked =
    envelope.pubkeys.length > 0
      ? envelope.pubkeys
      : rankedPubkeysFromOrder(envelope);
  return ranked.map((pubkey) => {
    const vertex = envelope.providers[pubkey]?.vertex;
    // Optional at runtime: callers that assemble an envelope by hand (tests,
    // the Vertex refresh path) may not carry the map.
    const identity = envelope.identities?.[pubkey];
    const rank = typeof vertex?.rank === 'number' ? vertex.rank : (identity?.vertex.rank ?? null);
    const score = typeof vertex?.score === 'number' ? vertex.score : (identity?.vertex.score ?? null);
    // Aggregates omit zero and are absent on a deployment without the nostr
    // module; the identity's reach answers there (and says null, not 0, when
    // nagg could not resolve the person).
    return {
      pubkey,
      metadata: metadataByPubkey[pubkey] ?? {},
      vertexFetchedAt: typeof vertex?.vertexFetchedAt === 'number' ? vertex.vertexFetchedAt : typeof vertex?.fetchedAt === 'number' ? vertex.fetchedAt : (identity?.vertex.fetchedAt ?? null),
      vertexFresh: envelope.vertexFresh,
      rank,
      score,
      followers: aggregateValue(envelope.aggregates, pubkey, 'followers') ?? identity?.reach.followers ?? null,
      follows: aggregateValue(envelope.aggregates, pubkey, 'following') ?? identity?.reach.follows ?? null,
      ...(identity ? { operatesMints: identity.operates.mints, operatesAiProviders: identity.operates.aiProviders } : {}),
    };
  });
}

/** Fallback ranking when `pubkeys` is absent: the kind-0 authors in `order`. */
function rankedPubkeysFromOrder(envelope: NaggProfilesEnvelope): string[] {
  const authorByEventId = new Map<string, string>();
  for (const event of envelope.events) {
    if (event.kind === 0) authorByEventId.set(event.id, event.pubkey);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of envelope.order) {
    const pubkey = authorByEventId.get(id);
    if (pubkey && !seen.has(pubkey)) {
      seen.add(pubkey);
      out.push(pubkey);
    }
  }
  return out;
}

/** Relay floor (NIP-50): latest kind-0 per author → unranked hits. */
export function profileSearchHitsFromKind0(
  events: ReadonlyArray<{ pubkey?: string; kind: number; content?: string; created_at?: number }>,
): ProfileSearchHit[] {
  const latestAt: Record<string, number> = {};
  const byPubkey: Record<string, ProfileSearchHit> = {};
  for (const event of events) {
    if (event.kind !== 0 || typeof event.pubkey !== 'string') continue;
    const at = typeof event.created_at === 'number' ? event.created_at : 0;
    if (event.pubkey in latestAt && at <= latestAt[event.pubkey]) continue;
    const metadata = parseProfileMetadata(typeof event.content === 'string' ? event.content : '');
    if (!metadata) continue;
    latestAt[event.pubkey] = at;
    byPubkey[event.pubkey] = { pubkey: event.pubkey, metadata };
  }
  return Object.values(byPubkey);
}
