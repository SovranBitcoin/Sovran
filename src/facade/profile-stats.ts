import type { NostrTier } from '@sovranbitcoin/schemas';
import type { RequestControls } from '../timeout';
import type { TierOutcome } from '../tiers';
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
};

export type ProfileStats = {
  pubkey: string;
  metadata?: ProfileMetadata;
  followersCount?: number;
  followingCount?: number;
  noteCount?: number;
  /** Unix seconds of the profile's earliest known event (Primal `time_joined`). */
  joinedAt?: number;
};

export type ProfileStatsBundle = ProfileStats;

export type ResolvedProfileStats = { tier: NostrTier } & ProfileStats;

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
    bundle.joinedAt === undefined
  );
}
