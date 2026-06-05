import type { EventQueryInput } from './rank';

export type ProfileSearchInput = {
  query: string;
  limit?: number;
  sort?: string;
  source?: string;
};

export const PROFILE_SEARCH_QUERY = `
query ProfileSearch($input: ProfileSearchInput!) {
  profileSearch(input: $input) {
    query
    limit
    sort
    source
    fromCache
    nodes {
      pubkey
      npub
      rank
      score
      searchRank
      searchScore
      profileRank
      profileScore
      followers
      follows
      createdAt
      name
      displayName
      picture
      image
      banner
      about
      nip05
      nip05Valid
      website
      lud16
      lud06
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;

export const PROFILE_EVENTS_SEARCH_QUERY = `
query ProfileEventsSearch($input: EventQueryInput!) {
  events(input: $input) {
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
    }
  }
}
`;

export function profileSearchInput(input: ProfileSearchInput): ProfileSearchInput {
  return {
    query: input.query,
    limit: input.limit ?? 10,
    sort: input.sort ?? 'globalPagerank',
    ...(input.source ? { source: input.source } : {}),
  };
}

export function profileEventsSearchInput(input: { query: string; limit?: number }): EventQueryInput {
  return {
    kinds: [0],
    search: input.query,
    limit: input.limit ?? 10,
  };
}
