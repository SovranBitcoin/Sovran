import { z } from 'zod';
import type { NostrTier } from '@sovranbitcoin/schemas';
import { NaggProfileSearchResultSchema } from '../schemas';
import type { RequestControls } from '../timeout';
import type { TierOutcome } from '../tiers';
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
  rank?: number | null;
  score?: number | null;
  followers?: number | null;
  follows?: number | null;
};

export type SearchRequest = RequestControls & {
  query: string;
  limit?: number;
  refresh?: boolean;
};

export type ProfileSearchBundle = { hits: ProfileSearchHit[] };

export type ResolvedProfileSearch = { tier: NostrTier; hits: ProfileSearchHit[] };

export interface SearchTier {
  readonly tier: NostrTier;
  searchProfiles(request: SearchRequest): Promise<TierOutcome<ProfileSearchBundle>>;
}

/** nagg `/nostr/search` REST response — mirrors the GraphQL `profileSearch` nodes. */
export const NaggProfileSearchRestSchema = z.object({
  query: z.string().optional(),
  limit: z.number().optional(),
  sort: z.string().optional(),
  fromCache: z.boolean().optional(),
  results: z.array(NaggProfileSearchResultSchema),
});

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** Map a ranked nagg search node into a tier-neutral hit. */
export function hitFromNaggSearchResult(
  node: z.infer<typeof NaggProfileSearchResultSchema>,
): ProfileSearchHit {
  const metadata: ProfileMetadata = {
    name: str(node.name),
    displayName: str(node.displayName),
    picture: str(node.picture) ?? str(node.image),
    banner: str(node.banner),
    nip05: str(node.nip05),
    lud16: str(node.lud16),
    website: str(node.website),
    about: str(node.about),
  };
  return {
    pubkey: node.pubkey,
    npub: node.npub,
    metadata,
    rank: node.rank ?? null,
    score: node.score ?? null,
    followers: node.followers ?? null,
    follows: node.follows ?? null,
  };
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
