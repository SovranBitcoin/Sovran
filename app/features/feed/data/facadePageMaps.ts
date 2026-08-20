import type { facade } from 'nostr';

import type { FeedEvent, NoteMetrics, ProfileInfo } from '../components/nostr/feedTypes';

type FacadePageEnrichment = Pick<facade.ResolvedFeedPage, 'stats' | 'profiles' | 'quoted'>;

export function mapFacadePageEnrichment(page: FacadePageEnrichment) {
  const metricsMap = new Map<string, NoteMetrics>();
  for (const [id, stats] of Object.entries(page.stats)) {
    metricsMap.set(id, {
      likeCount: stats.likes,
      repostCount: stats.reposts,
      replyCount: stats.replies,
      satsZapped: stats.satsZapped,
    });
  }

  const profilesMap = new Map<string, ProfileInfo>(
    Object.entries(page.profiles).map(([pubkey, profile]) => [
      pubkey,
      { name: profile.name, ...(profile.picture ? { picture: profile.picture } : {}) },
    ])
  );
  const quotedEventsMap = new Map<string, FeedEvent>(
    Object.entries(page.quoted) as [string, FeedEvent][]
  );

  return { metricsMap, profilesMap, quotedEventsMap };
}
