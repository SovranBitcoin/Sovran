// Posts-by-pubkeys recipes for the search "Posts" sub-tab: recent or popular
// notes authored by a provided set of pubkeys (the matched people). Reuses the
// generic events query (recent) and the ranked-events infrastructure (popular).
import type { RankedEventsInput } from './feed';
import type { EventQueryInput } from './rank';
import { engagementRankTerms, recencyTerm, vertexAuthorScoreTerm } from './rank';

export type PostsSort = 'recent' | 'popular';

const POST_KINDS = [1, 1111];

// Recent posts read via `eventsQueryAppView` (POST /nostr/events/query); popular
// posts read via `rankedFeedAppView` (POST /nostr/feed/ranked). These builders
// produce the respective inputs.

export function postsByPubkeysRecentInput(options: {
  pubkeys: string[];
  until?: number;
  limit?: number;
  offset?: number;
}): EventQueryInput {
  return {
    kinds: POST_KINDS,
    pubkeys: options.pubkeys,
    limit: options.limit ?? 30,
    ...(options.until ? { until: options.until } : {}),
    ...(options.offset ? { offset: options.offset } : {}),
  };
}

export function postsByPubkeysPopularInput(options: {
  pubkeys: string[];
  since?: number;
  until?: number;
  limit?: number;
}): RankedEventsInput {
  return {
    references: {
      kinds: [7, 9735, 6, 16, 1, 1111],
      since: options.since,
      until: options.until,
      limit: 1000,
    },
    via: { key: 'e' },
    target: {
      kinds: POST_KINDS,
      pubkeys: options.pubkeys,
      limit: options.limit ?? 30,
    },
    metric: { name: 'actors', op: 'COUNT_DISTINCT', distinctField: 'PUBKEY' },
    terms: [...engagementRankTerms(), vertexAuthorScoreTerm(0.25), recencyTerm(0.9)],
    limit: options.limit ?? 30,
  };
}
