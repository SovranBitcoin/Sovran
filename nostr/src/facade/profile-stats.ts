import type { NostrTier } from '@sovranbitcoin/schemas';
import type { RequestControls } from '../timeout';
import type { ReadProvenance, TierOutcome } from '../tiers';
import type { ProfileMetadata } from './profiles';

// ---------------------------------------------------------------------------
// Profile-stats surface — one profile's header: kind-0 metadata + the aggregate
// counts and joined date a profile page shows.
//
// Primal serves it in one `user_profile` call (kind-0 + the synthetic
// USER_PROFILE/10000105 stats event with follows/followers/note counts +
// `time_joined`). The relay floor derives metadata + following-count from the
// profile's own kind-0 / kind-3. Reputation (vertex pagerank) is nagg-only and
// stays on the app's REST path — it has no Primal/relay equivalent.
// ---------------------------------------------------------------------------

export type ProfileStatsRequest = RequestControls & {
  pubkey: string;
  /** Forwarded to Primal's `user_profile` (its `user_pubkey` param). */
  viewerPubkey?: string;
  /** Bypass the cache-first short-circuit and force a fresh tier fetch. */
  refresh?: boolean;
};

export type ProfileStats = {
  pubkey: string;
  metadata?: ProfileMetadata;
  followersCount?: number;
  followingCount?: number;
  noteCount?: number;
  /** Unix seconds of the profile's earliest known event (Primal `time_joined`). */
  joinedAtSec?: number;
  /**
   * Vertex web-of-trust reputation (0–100). nagg-only: search hits, discovery
   * rows and the REST profile carry it; Primal and relays never do. Undefined
   * is "nobody has measured it", which the app renders as a dash, never 0.
   */
  score?: number;
  /** Vertex pagerank; the raw figure `score` is a saturating transform of. */
  rank?: number;
  /** Unix seconds the Vertex figures were fetched, so a refresh can judge staleness. */
  vertexFetchedAt?: number;
  /** Mint URLs this pubkey operates (NUT-06 nostr contact), per nagg identities. */
  operatesMints?: readonly string[];
  /** AI provider base URLs this pubkey operates, per nagg identities. */
  operatesAiProviders?: readonly string[];
};

export type ProfileStatsBundle = ProfileStats;

export type ResolvedProfileStats = { tier: NostrTier; provenance?: ReadProvenance } & ProfileStats;

export interface ProfileStatsTier {
  readonly tier: NostrTier;
  getProfileStats(request: ProfileStatsRequest): Promise<TierOutcome<ProfileStatsBundle>>;
}

/** True when a bundle carries nothing worth rendering, so the facade should
 *  fall through to the next tier instead of answering with an empty header. */
export function profileStatsIsEmpty(bundle: ProfileStats): boolean {
  return (
    !bundle.metadata &&
    bundle.followersCount === undefined &&
    bundle.followingCount === undefined &&
    bundle.noteCount === undefined &&
    bundle.joinedAtSec === undefined &&
    bundle.score === undefined
  );
}
