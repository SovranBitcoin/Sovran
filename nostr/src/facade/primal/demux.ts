import type { NaggFeedEvent, NaggProfileInfo } from '../../map/feed';
import { toFeedEvent } from '../event';
import { profilesFromKind0, type ProfileMetadata } from '../profiles';
import type { ProfileStatsBundle } from '../profile-stats';
import { socialGraphFromEvents, type SocialGraph } from '../social-graph';
import { PRIMAL_KIND, type RawPrimalEvent } from './protocol';
import { PrimalUserProfileContent, parseContent } from './schemas';

// ---------------------------------------------------------------------------
// Primal demux
//
// Turn one collected batch of mixed-kind Primal events into a contract bundle,
// so the facade merges it identically regardless of which tier answered.
// Everything is validated at ingest; an event that fails validation is
// skipped, never crashes the batch.
// ---------------------------------------------------------------------------

/**
 * `user_profile` batch → one profile's header. The real kind-0 gives metadata;
 * the synthetic USER_PROFILE (10000105) gives follow/follower/note counts and
 * `time_joined` (joined date). Both are keyed to the requested pubkey.
 */
export function demuxPrimalProfileStats(
  events: ReadonlyArray<RawPrimalEvent>,
  pubkey: string,
): ProfileStatsBundle {
  const metadata: ProfileMetadata | undefined = profilesFromKind0(events)[pubkey];
  let followersCount: number | undefined;
  let followingCount: number | undefined;
  let noteCount: number | undefined;
  let joinedAtSec: number | undefined;

  for (const raw of events) {
    if (raw.kind !== PRIMAL_KIND.userStats) continue;
    const stats = parseContent(PrimalUserProfileContent, raw.content);
    if (!stats || (stats.pubkey && stats.pubkey !== pubkey)) continue;
    if (stats.followers_count != null) followersCount = stats.followers_count;
    if (stats.follows_count != null) followingCount = stats.follows_count;
    if (stats.note_count != null) noteCount = stats.note_count;
    if (stats.time_joined != null) joinedAtSec = stats.time_joined;
  }

  return {
    pubkey,
    ...(metadata ? { metadata } : {}),
    ...(followersCount !== undefined ? { followersCount } : {}),
    ...(followingCount !== undefined ? { followingCount } : {}),
    ...(noteCount !== undefined ? { noteCount } : {}),
    ...(joinedAtSec !== undefined ? { joinedAtSec } : {}),
  };
}

/**
 * `contact_list` (extended_response) batch → the profile's follow set plus the
 * bundled kind-0s of who it follows. Reuses the floor's kind-3 parser, then
 * layers the followed users' profiles on top from the extended payload.
 */
export function demuxPrimalSocialGraph(
  events: ReadonlyArray<RawPrimalEvent>,
  pubkey: string,
): SocialGraph {
  const feedEvents: NaggFeedEvent[] = [];
  for (const raw of events) {
    const event = toFeedEvent(raw);
    if (event) feedEvents.push(event);
  }
  const graph = socialGraphFromEvents(pubkey, feedEvents);
  const profiles: Record<string, NaggProfileInfo> = {};
  for (const [pk, m] of Object.entries(profilesFromKind0(events))) {
    profiles[pk] = { name: m.displayName || m.name || '', ...(m.picture ? { picture: m.picture } : {}) };
  }
  return { ...graph, profiles };
}
