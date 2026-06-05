// Whitenoise (MLS / Marmot) recipes. nagg indexes the group events; the client
// decrypts them via Marmot. Group membership is MLS-private, so the client must
// supply the group ids (the hex nostr group id from local MLS state).
import type { EventQueryInput } from './rank';

export const WHITENOISE_GROUP_MESSAGES_QUERY = `
query WhitenoiseGroupMessages($input: EventQueryInput!) {
  events(input: $input) {
    nodes {
      id
      pubkey
      kind
      createdAt
      content
      tags
      sig
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;

// Welcome/invite events are delivered inside gift wraps (kind 1059) addressed to
// the viewer, so invites reuse the gift-wrap inbox query.
export const WHITENOISE_INVITES_QUERY = `
query WhitenoiseInvites($input: EventQueryInput!) {
  events(input: $input) {
    nodes {
      id
      pubkey
      kind
      createdAt
      content
      tags
      sig
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;

// MLS group message (kind 445), filtered by the `#h` nostr group id set.
export function whitenoiseGroupMessagesInput(options: {
  groupIds: string[];
  since?: number;
  until?: number;
  limit?: number;
}): EventQueryInput {
  return {
    kinds: [445],
    tags: [{ key: 'h', values: options.groupIds }],
    ...(options.since ? { since: options.since } : {}),
    ...(options.until ? { until: options.until } : {}),
    limit: options.limit ?? 200,
  };
}

// Gift-wrapped welcome invites (kind 1059) addressed to the viewer.
export function whitenoiseInvitesInput(options: {
  viewer: string;
  since?: number;
  until?: number;
  limit?: number;
}): EventQueryInput {
  return {
    kinds: [1059],
    tags: [{ key: 'p', value: options.viewer }],
    ...(options.since ? { since: options.since } : {}),
    ...(options.until ? { until: options.until } : {}),
    limit: options.limit ?? 100,
  };
}
