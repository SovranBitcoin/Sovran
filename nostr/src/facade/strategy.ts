import type { NotificationSortKey } from "./notifications";
import type { NostrTier } from '@sovranbitcoin/schemas';
import type { TierOutcome } from '../tiers';
import type { FeedBundle, FeedPageRequest } from './feed';
import type { ThreadBundle, ThreadRequest } from './thread';
import type { NotificationItem, NotificationsBundle, NotificationsRequest } from './notifications';
import type { OwnHistoryBundle, OwnHistoryRequest } from './own-state';
import type {
  DiscoverMintsRequest,
  DiscoveredMint,
  MintReviewsRequest,
  MintReviewsSummary,
} from './mint-reviews';
import type { SocialGraph, SocialGraphRequest } from './social-graph';
import type { DmEnvelope, DmEnvelopesBundle, DmEnvelopesRequest } from './dm';
import type { ProfilesBundle, ProfilesRequest } from './profiles';
import type { ProfileStatsBundle, ProfileStatsRequest } from './profile-stats';
import type { ProfileSearchBundle, SearchRequest } from './search';

// ---------------------------------------------------------------------------
// Tier strategy — one deep module per source, implementing the surfaces it can
//
// A tier (nagg / Primal / relay) implements only the surface methods it can
// serve. The facade builds each read's tier list from the strategies that
// implement that surface: a strategy WITHOUT the method is skipped entirely
// ("this source doesn't do threads"); a strategy WITH the method that returns
// `unsupported` is recorded in the attempt trail ("does threads, not this one").
// This keeps wiring trivial — pass [nagg, primal, relay] once — and lets each
// surface grow independently.
// ---------------------------------------------------------------------------

export interface NostrTierStrategy {
  readonly tier: NostrTier;
  feedPage?(request: FeedPageRequest): Promise<TierOutcome<FeedBundle>>;
  thread?(request: ThreadRequest): Promise<TierOutcome<ThreadBundle>>;
  notifications?(request: NotificationsRequest): Promise<TierOutcome<NotificationsBundle>>;
  /**
   * Open a LIVE listener for events that notify the viewer — the push
   * counterpart of the one-shot `notifications`. Only the relay tier streams;
   * other tiers omit it. No auto-reconnect (same contract as dmLiveSubscribe):
   * a caller needing at-least-once pairs it with a poll backstop. `since`
   * bounds relay backfill volume only — classification is unbounded so that
   * evidence for already-known rows still merges. Returns an unsubscribe.
   */
  notificationsLiveSubscribe?(
    request: NotificationsRequest,
    since: NotificationSortKey | undefined,
    onItems: (items: readonly NotificationItem[]) => void,
  ): () => void;
  ownHistory?(request: OwnHistoryRequest): Promise<TierOutcome<OwnHistoryBundle>>;
  getMintReviews?(request: MintReviewsRequest): Promise<TierOutcome<MintReviewsSummary>>;
  discoverMints?(request: DiscoverMintsRequest): Promise<TierOutcome<DiscoveredMint[]>>;
  getSocialGraph?(request: SocialGraphRequest): Promise<TierOutcome<SocialGraph>>;
  getDmEnvelopes?(request: DmEnvelopesRequest): Promise<TierOutcome<DmEnvelopesBundle>>;
  /**
   * Open a LIVE listener for DM envelopes (NIP-17 gift wraps / NIP-04) addressed
   * to the viewer — the push counterpart of the one-shot `getDmEnvelopes`. Only
   * the relay tier streams; other tiers omit it. Returns an unsubscribe.
   *
   * No auto-reconnect: the underlying REQ stops feeding on socket close, so
   * callers that need at-least-once delivery must pair this with a poll backstop
   * (the payment-request transport does exactly this).
   */
  dmLiveSubscribe?(
    request: DmEnvelopesRequest,
    onEnvelope: (envelope: DmEnvelope) => void,
  ): () => void;
  getProfiles?(request: ProfilesRequest): Promise<TierOutcome<ProfilesBundle>>;
  getProfileStats?(request: ProfileStatsRequest): Promise<TierOutcome<ProfileStatsBundle>>;
  searchProfiles?(request: SearchRequest): Promise<TierOutcome<ProfileSearchBundle>>;
}
