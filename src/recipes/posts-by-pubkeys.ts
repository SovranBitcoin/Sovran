// Posts-by-pubkeys recipes for the search "Posts" sub-tab: recent or popular
// notes authored by a provided set of pubkeys (the matched people). Reuses the
// generic events query (recent) and the ranked-events infrastructure (popular).
import type { RankedEventsInput } from './feed';
import type { EventQueryInput } from './rank';
import { engagementRankTerms, recencyTerm, vertexAuthorScoreTerm } from './rank';

export type PostsSort = 'recent' | 'popular';

const POST_KINDS = [1, 1111];

const POST_EVENT_SELECTION = `
    nodes {
      id
      pubkey
      kind
      createdAt
      content
      tags
    }
    pageInfo {
      hasNextPage
      endCursor
    }`;

export const POSTS_RECENT_QUERY = `
query PostsByPubkeysRecent($input: EventQueryInput!) {
  events(input: $input) {${POST_EVENT_SELECTION}
  }
}
`;

export const POSTS_POPULAR_QUERY = `
query PostsByPubkeysPopular($input: RankedEventsInput!) {
  rankedEvents(input: $input) {${POST_EVENT_SELECTION}
  }
}
`;

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

// postsByPubkeys selects the query + variables for the requested sort, so the
// caller can issue a single typed request.
export function postsByPubkeys(options: {
  pubkeys: string[];
  sort: PostsSort;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}): { query: string; variables: { input: EventQueryInput | RankedEventsInput } } {
  if (options.sort === 'popular') {
    return {
      query: POSTS_POPULAR_QUERY,
      variables: { input: postsByPubkeysPopularInput(options) },
    };
  }
  return {
    query: POSTS_RECENT_QUERY,
    variables: { input: postsByPubkeysRecentInput(options) },
  };
}
