import { parseWith } from '@sovranbitcoin/schemas';
import type { Result } from 'neverthrow';
import { backendConfig } from '@/shared/config/backend';
import { fetchJson } from '@/shared/lib/apiClient';
import { apiLog, feedLog, redactError } from '@/shared/lib/logger';
import {
  buildThreadStructure,
  type ThreadStructure,
} from '@/features/feed/lib/buildThreadStructure';
import { mapNaggFeedPage } from './mapNaggFeedPage';
import type {
  FeedClient,
  FeedEnrichmentRequest,
  FeedEnrichmentUpdates,
  FeedParseResult,
  FeedPageRequest,
  ThreadRequest,
  ThreadReplySort,
  ThreadResult,
  UserFeedPageRequest,
} from './feedClient';
import { emptyFeedParseResult } from './feedClient';
import { hasEmptyExplicitPubkeys, hydrateSpecWithPubkey } from './feedSpec';
import { NaggGraphqlEnvelope } from './naggSchemas';
import type { NaggFeedResponseData } from './naggSchemas';
import { getFirstTagValue, parseJson } from '../components/nostr/feedParse';
import type { FeedEvent, NoteMetrics, ProfileInfo } from '../components/nostr/feedTypes';

const parseNaggGraphqlEnvelope = parseWith(NaggGraphqlEnvelope, 'nagg/graphql');
const RELEVANT_AUTHOR_REPLY_LIMIT = 50;

const BASE_EVENT_SELECTION = `
  id
  pubkey
  kind
  createdAt
  content
  tags
`;

const METRIC_SELECTION = `
  likes: aggregateReferencedBy(input: {
    via: { key: "e" }
    events: { kinds: [7], limit: 500 }
    metrics: [
      { name: "pubkeys", op: "COUNT_DISTINCT", distinctField: "PUBKEY" }
    ]
  }) { rows { metrics } }
  reposts: aggregateReferencedBy(input: {
    via: { key: "e" }
    events: { kinds: [6, 16], limit: 500 }
    metrics: [
      { name: "pubkeys", op: "COUNT_DISTINCT", distinctField: "PUBKEY" }
    ]
  }) { rows { metrics } }
  replyStats: aggregateReferencedBy(input: {
    via: { key: "e" }
    events: { kinds: [1], limit: 500 }
    metrics: [
      { name: "events", op: "COUNT" }
    ]
  }) { rows { metrics } }
  zaps: aggregateReferencedBy(input: {
    via: { key: "e" }
    events: { kinds: [9735], limit: 500 }
    metrics: [
      { name: "amountSats", op: "SUM", derived: "nip57.amount_sats" }
    ]
  }) { rows { metrics } }
`;

const AUTHOR_METADATA_SELECTION = `
  authorMetadata: pubkeyEvents(kinds: [0], limit: 1) {
    ${BASE_EVENT_SELECTION}
  }
`;

const QUOTED_CONTENT_SELECTION = `
  quotedContent: selectedReferences(input: { fallback: { key: "q" }, limit: 4 }) {
    nodes {
      ${BASE_EVENT_SELECTION}
      ${AUTHOR_METADATA_SELECTION}
      ${METRIC_SELECTION}
    }
  }
`;

const FEED_REPLY_PREVIEW_BASE_SELECTION = `
  ${BASE_EVENT_SELECTION}
  ${AUTHOR_METADATA_SELECTION}
`;

const FEED_REPLY_PREVIEW_CHILD_SELECTION = `
  ${FEED_REPLY_PREVIEW_BASE_SELECTION}
`;

const FEED_REPLY_PREVIEW_SOURCE_SELECTION = `
  ${FEED_REPLY_PREVIEW_BASE_SELECTION}
  childAuthorReplies: referencedBy(input: {
    via: { key: "e" }
    events: {
      kinds: [1, 1111]
      pubkeysFrom: [{ sourceEventAuthor: true }]
      limit: 50
    }
    limit: 50
  }) {
    nodes {
      ${FEED_REPLY_PREVIEW_CHILD_SELECTION}
    }
  }
  childFollowedReply: rankedReferencedBy(input: {
    via: { key: "e" }
    events: {
      kinds: [1, 1111]
      pubkeysFrom: [{
        latestEventTags: {
          pubkey: $viewerPubkey
          kinds: [3]
          tag: { key: "p" }
          limit: 1
          maxValues: 2000
        }
      }]
      limit: 50
    }
    rank: {
      references: { kinds: [7], limit: 500 }
      via: { key: "e" }
      metric: { name: "likers", op: "COUNT_DISTINCT", distinctField: "PUBKEY" }
    }
    limit: 1
  }) {
    nodes {
      ${FEED_REPLY_PREVIEW_CHILD_SELECTION}
    }
  }
`;

const EVENT_REFS_SELECTION = `
  eventRefs: selectedReferences(input: { fallback: { key: "e" }, limit: 2 }) {
    nodes {
      ${BASE_EVENT_SELECTION}
      ${AUTHOR_METADATA_SELECTION}
      ${QUOTED_CONTENT_SELECTION}
      ${METRIC_SELECTION}
    }
  }
`;

const ROOT_CONTEXT_SELECTION = `
  rootContext: selectedReferences(input: {
    selectors: [{ key: "e", marker: "root" }]
    fallback: { key: "e", excludeMarkers: ["mention"] }
    maxDepth: 8
    limit: 1
  }) {
    nodes {
      ${BASE_EVENT_SELECTION}
      ${AUTHOR_METADATA_SELECTION}
      ${QUOTED_CONTENT_SELECTION}
      ${METRIC_SELECTION}
    }
  }
`;

const FEED_QUERY = `
query NaggGraphqlFeed($input: EventQueryInput!) {
  events(input: $input) {
    nodes {
      ${BASE_EVENT_SELECTION}
      ${AUTHOR_METADATA_SELECTION}
      ${ROOT_CONTEXT_SELECTION}
      ${EVENT_REFS_SELECTION}
      ${QUOTED_CONTENT_SELECTION}
      ${METRIC_SELECTION}
    }
    pageInfo { endCursor hasNextPage }
  }
}
`;

const TRENDING_FEED_QUERY = `
query NaggGraphqlTrendingFeed($input: RankedEventsInput!) {
  rankedEvents(input: $input) {
    nodes {
      ${BASE_EVENT_SELECTION}
      ${AUTHOR_METADATA_SELECTION}
      ${ROOT_CONTEXT_SELECTION}
      ${EVENT_REFS_SELECTION}
      ${QUOTED_CONTENT_SELECTION}
      ${METRIC_SELECTION}
    }
    pageInfo { endCursor hasNextPage }
  }
}
`;

const TRENDING_FEED_WITH_VIEWER_QUERY = `
query NaggGraphqlTrendingFeed($input: RankedEventsInput!, $viewerPubkey: String!) {
  rankedEvents(input: $input) {
    nodes {
      ${BASE_EVENT_SELECTION}
      ${AUTHOR_METADATA_SELECTION}
      ${ROOT_CONTEXT_SELECTION}
      ${EVENT_REFS_SELECTION}
      ${QUOTED_CONTENT_SELECTION}
      authorReplies: referencedBy(input: {
        via: { key: "e" }
        events: {
          kinds: [1, 1111]
          pubkeysFrom: [{ sourceEventAuthor: true }]
          limit: 50
        }
        limit: 50
      }) {
        nodes {
          ${FEED_REPLY_PREVIEW_SOURCE_SELECTION}
        }
      }
      followedReply: rankedReferencedBy(input: {
        via: { key: "e" }
        events: {
          kinds: [1, 1111]
          pubkeysFrom: [{
            latestEventTags: {
              pubkey: $viewerPubkey
              kinds: [3]
              tag: { key: "p" }
              limit: 1
              maxValues: 2000
            }
          }]
          limit: 50
        }
        rank: {
          references: { kinds: [7], limit: 500 }
          via: { key: "e" }
          metric: { name: "likers", op: "COUNT_DISTINCT", distinctField: "PUBKEY" }
        }
        limit: 1
      }) {
        nodes {
          ${FEED_REPLY_PREVIEW_BASE_SELECTION}
        }
      }
      ${METRIC_SELECTION}
    }
    pageInfo { endCursor hasNextPage }
  }
}
`;

const TRENDING_FEED_WITH_VIEWER_LEGACY_QUERY = `
query NaggGraphqlTrendingFeed($input: RankedEventsInput!, $viewerPubkey: String!) {
  rankedEvents(input: $input) {
    nodes {
      ${BASE_EVENT_SELECTION}
      ${AUTHOR_METADATA_SELECTION}
      ${ROOT_CONTEXT_SELECTION}
      ${EVENT_REFS_SELECTION}
      ${QUOTED_CONTENT_SELECTION}
      followedReply: rankedReferencedBy(input: {
        via: { key: "e" }
        events: {
          kinds: [1, 1111]
          pubkeysFrom: [{
            latestEventTags: {
              pubkey: $viewerPubkey
              kinds: [3]
              tag: { key: "p" }
              limit: 1
              maxValues: 2000
            }
          }]
          limit: 50
        }
        rank: {
          references: { kinds: [7], limit: 500 }
          via: { key: "e" }
          metric: { name: "likers", op: "COUNT_DISTINCT", distinctField: "PUBKEY" }
        }
        limit: 1
      }) {
        nodes {
          ${FEED_REPLY_PREVIEW_BASE_SELECTION}
        }
      }
      ${METRIC_SELECTION}
    }
    pageInfo { endCursor hasNextPage }
  }
}
`;

const FOLLOWING_REPLIES_QUERY = `
query NaggGraphqlFollowingReplies($input: EventQueryInput!) {
  events(input: $input) {
    nodes {
      ${BASE_EVENT_SELECTION}
      ${AUTHOR_METADATA_SELECTION}
      ${ROOT_CONTEXT_SELECTION}
      ${QUOTED_CONTENT_SELECTION}
      ${METRIC_SELECTION}
    }
    pageInfo { endCursor hasNextPage }
  }
}
`;

const FOLLOWING_POPULAR_QUERY = `
query NaggGraphqlFollowingPopular($input: RankedEventsInput!) {
  rankedEvents(input: $input) {
    nodes {
      ${BASE_EVENT_SELECTION}
      ${AUTHOR_METADATA_SELECTION}
      ${ROOT_CONTEXT_SELECTION}
      ${EVENT_REFS_SELECTION}
      ${QUOTED_CONTENT_SELECTION}
      ${METRIC_SELECTION}
    }
    pageInfo { endCursor hasNextPage }
  }
}
`;

const FOLLOWING_POPULAR_WITH_VIEWER_QUERY = `
query NaggGraphqlFollowingPopular($input: RankedEventsInput!, $viewerPubkey: String!) {
  rankedEvents(input: $input) {
    nodes {
      ${BASE_EVENT_SELECTION}
      ${AUTHOR_METADATA_SELECTION}
      ${ROOT_CONTEXT_SELECTION}
      ${EVENT_REFS_SELECTION}
      ${QUOTED_CONTENT_SELECTION}
      authorReplies: referencedBy(input: {
        via: { key: "e" }
        events: {
          kinds: [1, 1111]
          pubkeysFrom: [{ sourceEventAuthor: true }]
          limit: 50
        }
        limit: 50
      }) {
        nodes {
          ${FEED_REPLY_PREVIEW_SOURCE_SELECTION}
        }
      }
      followedReply: rankedReferencedBy(input: {
        via: { key: "e" }
        events: {
          kinds: [1, 1111]
          pubkeysFrom: [{
            latestEventTags: {
              pubkey: $viewerPubkey
              kinds: [3]
              tag: { key: "p" }
              limit: 1
              maxValues: 2000
            }
          }]
          limit: 50
        }
        rank: {
          references: { kinds: [7], limit: 500 }
          via: { key: "e" }
          metric: { name: "likers", op: "COUNT_DISTINCT", distinctField: "PUBKEY" }
        }
        limit: 1
      }) {
        nodes {
          ${FEED_REPLY_PREVIEW_BASE_SELECTION}
        }
      }
      ${METRIC_SELECTION}
    }
    pageInfo { endCursor hasNextPage }
  }
}
`;

const FOLLOWING_POPULAR_WITH_VIEWER_LEGACY_QUERY = `
query NaggGraphqlFollowingPopular($input: RankedEventsInput!, $viewerPubkey: String!) {
  rankedEvents(input: $input) {
    nodes {
      ${BASE_EVENT_SELECTION}
      ${AUTHOR_METADATA_SELECTION}
      ${ROOT_CONTEXT_SELECTION}
      ${EVENT_REFS_SELECTION}
      ${QUOTED_CONTENT_SELECTION}
      followedReply: rankedReferencedBy(input: {
        via: { key: "e" }
        events: {
          kinds: [1, 1111]
          pubkeysFrom: [{
            latestEventTags: {
              pubkey: $viewerPubkey
              kinds: [3]
              tag: { key: "p" }
              limit: 1
              maxValues: 2000
            }
          }]
          limit: 50
        }
        rank: {
          references: { kinds: [7], limit: 500 }
          via: { key: "e" }
          metric: { name: "likers", op: "COUNT_DISTINCT", distinctField: "PUBKEY" }
        }
        limit: 1
      }) {
        nodes {
          ${FEED_REPLY_PREVIEW_BASE_SELECTION}
        }
      }
      ${METRIC_SELECTION}
    }
    pageInfo { endCursor hasNextPage }
  }
}
`;

const ENRICH_EVENTS_QUERY = `
query NaggGraphqlEnrichEvents($input: EventQueryInput!) {
  events(input: $input) {
    nodes {
      ${BASE_EVENT_SELECTION}
      authorMetadata: pubkeyEvents(kinds: [0], limit: 1) {
        ${BASE_EVENT_SELECTION}
      }
      quotedContent: references(input: { tags: [{ key: "q" }], limit: 4 }) {
        nodes {
          ${BASE_EVENT_SELECTION}
          authorMetadata: pubkeyEvents(kinds: [0], limit: 1) {
            ${BASE_EVENT_SELECTION}
          }
          ${METRIC_SELECTION}
        }
      }
      ${METRIC_SELECTION}
    }
  }
}
`;

const PROFILE_EVENTS_QUERY = `
query NaggGraphqlProfiles($input: EventQueryInput!) {
  events(input: $input) {
    nodes {
      ${BASE_EVENT_SELECTION}
    }
  }
}
`;

const THREAD_REPLY_SELECTION = `
  ${BASE_EVENT_SELECTION}
  authorMetadata: pubkeyEvents(kinds: [0], limit: 1) {
    ${BASE_EVENT_SELECTION}
  }
  quotedContent: references(input: { tags: [{ key: "q" }], limit: 4 }) {
    nodes {
      ${BASE_EVENT_SELECTION}
      authorMetadata: pubkeyEvents(kinds: [0], limit: 1) {
        ${BASE_EVENT_SELECTION}
      }
      ${METRIC_SELECTION}
    }
  }
  ${METRIC_SELECTION}
`;

const THREAD_RELEVANT_REPLY_SELECTION = `
  ${THREAD_REPLY_SELECTION}
  childAuthorReplies: referencedBy(input: {
    via: { key: "e" }
    events: {
      kinds: [1, 1111]
      pubkeysFrom: [{ sourceEventAuthor: true }]
      limit: 50
    }
    limit: 50
  }) {
    nodes {
      ${THREAD_REPLY_SELECTION}
    }
  }
  childFollowedReply: rankedReferencedBy(input: {
    via: { key: "e" }
    events: {
      kinds: [1, 1111]
      pubkeysFrom: [{
        latestEventTags: {
          pubkey: $viewerPubkey
          kinds: [3]
          tag: { key: "p" }
          limit: 1
          maxValues: 2000
        }
      }]
      limit: 50
    }
    rank: {
      references: { kinds: [7], limit: 500 }
      via: { key: "e" }
      metric: { name: "likers", op: "COUNT_DISTINCT", distinctField: "PUBKEY" }
    }
    limit: 1
  }) {
    nodes {
      ${THREAD_REPLY_SELECTION}
    }
  }
`;

const AUTHOR_REPLIES_SELECTION = `
  authorReplies: referencedBy(input: {
    via: { key: "e" }
    events: {
      kinds: [1, 1111]
      pubkeysFrom: [{ sourceEventAuthor: true }]
      limit: 50
    }
    limit: 50
  }) {
    nodes {
      ${THREAD_RELEVANT_REPLY_SELECTION}
    }
  }
`;

const FOLLOWED_REPLY_SELECTION = `
  followedReply: rankedReferencedBy(input: {
    via: { key: "e" }
    events: {
      kinds: [1, 1111]
      pubkeysFrom: [{
        latestEventTags: {
          pubkey: $viewerPubkey
          kinds: [3]
          tag: { key: "p" }
          limit: 1
          maxValues: 2000
        }
      }]
      limit: 50
    }
    rank: {
      references: { kinds: [7], limit: 500 }
      via: { key: "e" }
      metric: { name: "likers", op: "COUNT_DISTINCT", distinctField: "PUBKEY" }
    }
    limit: 1
  }) {
    nodes {
      ${THREAD_REPLY_SELECTION}
    }
  }
`;

const THREAD_EVENT_SELECTION = `
  ${BASE_EVENT_SELECTION}
  authorMetadata: pubkeyEvents(kinds: [0], limit: 1) {
    ${BASE_EVENT_SELECTION}
  }
  parentRefs: references(input: { tags: [{ key: "e" }], limit: 8 }) {
    nodes {
      ${BASE_EVENT_SELECTION}
      authorMetadata: pubkeyEvents(kinds: [0], limit: 1) {
        ${BASE_EVENT_SELECTION}
      }
      ${METRIC_SELECTION}
    }
  }
  quotedContent: references(input: { tags: [{ key: "q" }], limit: 4 }) {
    nodes {
      ${BASE_EVENT_SELECTION}
      authorMetadata: pubkeyEvents(kinds: [0], limit: 1) {
        ${BASE_EVENT_SELECTION}
      }
      ${METRIC_SELECTION}
    }
  }
`;

const THREAD_NEW_QUERY = `
query NaggGraphqlThread($id: String!, $limit: Int!, $offset: Int!) {
  event(id: $id) {
    ${THREAD_EVENT_SELECTION}
    replies: referencedBy(input: {
      via: { key: "e" }
      events: { kinds: [1, 1111], limit: $limit }
      limit: $limit
      offset: $offset
    }) {
      nodes {
        ${THREAD_REPLY_SELECTION}
      }
    }
    ${METRIC_SELECTION}
  }
}
`;

const THREAD_RANKED_QUERY = `
query NaggGraphqlThread(
  $id: String!
  $limit: Int!
  $offset: Int!
  $candidateLimit: Int!
  $rank: ReferenceRankInput!
) {
  event(id: $id) {
    ${THREAD_EVENT_SELECTION}
    replies: rankedReferencedBy(input: {
      via: { key: "e" }
      events: { kinds: [1, 1111], limit: $candidateLimit }
      rank: $rank
      limit: $limit
      offset: $offset
    }) {
      nodes {
        ${THREAD_REPLY_SELECTION}
      }
    }
    ${METRIC_SELECTION}
  }
}
`;

const THREAD_RELEVANT_QUERY = `
query NaggGraphqlThreadRelevant(
  $id: String!
  $candidateLimit: Int!
  $rankedLimit: Int!
  $rank: ReferenceRankInput!
  $viewerPubkey: String!
) {
  event(id: $id) {
    ${THREAD_EVENT_SELECTION}
    ${AUTHOR_REPLIES_SELECTION}
    ${FOLLOWED_REPLY_SELECTION}
    replies: rankedReferencedBy(input: {
      via: { key: "e" }
      events: { kinds: [1, 1111], limit: $candidateLimit }
      rank: $rank
      limit: $rankedLimit
    }) {
      nodes {
        ${THREAD_REPLY_SELECTION}
      }
    }
    allReplies: referencedBy(input: {
      via: { key: "e" }
      events: { kinds: [1, 1111], limit: $candidateLimit }
      limit: $candidateLimit
    }) {
      nodes {
        ${THREAD_REPLY_SELECTION}
      }
    }
    ${METRIC_SELECTION}
  }
}
`;

type GraphqlAggregate = {
  rows?: { dimensions?: Record<string, string>; metrics?: Record<string, number> }[];
};

type GraphqlConnection<T> = {
  nodes?: T[];
  pageInfo?: { endCursor?: string | null; hasNextPage?: boolean };
};

type GraphqlEventNode = {
  id: string;
  pubkey: string;
  kind: number;
  createdAt: string | number | Date;
  content: string;
  tags: string[][];
  authorMetadata?: GraphqlEventNode[];
  eventRefs?: GraphqlConnection<GraphqlEventNode>;
  rootContext?: GraphqlConnection<GraphqlEventNode>;
  parentReplyRefs?: GraphqlConnection<GraphqlEventNode>;
  parentRootRefs?: GraphqlConnection<GraphqlEventNode>;
  parentRefs?: GraphqlConnection<GraphqlEventNode>;
  quotedContent?: GraphqlConnection<GraphqlEventNode>;
  authorReplies?: GraphqlConnection<GraphqlEventNode>;
  followedReply?: GraphqlConnection<GraphqlEventNode>;
  childAuthorReplies?: GraphqlConnection<GraphqlEventNode>;
  childFollowedReply?: GraphqlConnection<GraphqlEventNode>;
  allReplies?: GraphqlConnection<GraphqlEventNode>;
  replies?: GraphqlConnection<GraphqlEventNode>;
  childReplies?: GraphqlConnection<GraphqlEventNode>;
  likes?: GraphqlAggregate;
  reposts?: GraphqlAggregate;
  replyStats?: GraphqlAggregate;
  zaps?: GraphqlAggregate;
  [key: string]: unknown;
};

type GraphqlFeedData = {
  events?: GraphqlConnection<GraphqlEventNode>;
  rankedEvents?: GraphqlConnection<GraphqlEventNode>;
};

type GraphqlThreadData = {
  event?: GraphqlEventNode | null;
};

type EventQueryInput = {
  ids?: string[];
  pubkeys?: string[];
  pubkeysFrom?: {
    latestEventTags?: {
      pubkey: string;
      kinds: number[];
      tag: { key: string; value?: string; values?: string[] };
      limit?: number;
      maxValues?: number;
    };
    sourceEventAuthor?: boolean;
  }[];
  kinds?: number[];
  tags?: { key: string; value?: string; values?: string[] }[];
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
};

type TagFilterInput = { key: string; value?: string; values?: string[] };

type GenericMetricInput = {
  name: string;
  op: string;
  field?: string;
  tagKey?: string;
  tagIndex?: number;
  derived?: string;
  distinctField?: string;
};

type WeightedRankTermInput = {
  references: EventQueryInput;
  via: TagFilterInput;
  metric?: GenericMetricInput;
  weight?: number;
  transform?: 'IDENTITY' | 'LOG1P';
};

type CandidatePubkeyBoostInput = {
  pubkeys?: string[];
  pubkeysFrom?: NonNullable<EventQueryInput['pubkeysFrom']>;
  weight?: number;
};

type ReferenceRankInput = WeightedRankTermInput & {
  candidatePubkeyBoosts?: CandidatePubkeyBoostInput[];
  terms?: WeightedRankTermInput[];
};

type RankedEventsInput = {
  references: EventQueryInput;
  via: TagFilterInput;
  target?: EventQueryInput;
  metric?: GenericMetricInput;
  limit?: number;
  offset?: number;
};

type FeedQueryOptions = {
  includeNote?: (event: FeedEvent) => boolean;
  includeRepost?: (event: FeedEvent) => boolean;
  extraProfile?: { pubkey: string; profile: ProfileInfo };
};

function graphqlEndpoint(): string {
  return backendConfig.nostrGraphqlEndpoint;
}

function withRefreshInit(
  init: RequestInit | undefined,
  refresh: boolean | undefined
): RequestInit | undefined {
  if (!refresh) return init;
  const headers = new Headers(init?.headers);
  headers.set('Cache-Control', 'no-cache');
  headers.set('Pragma', 'no-cache');
  return {
    ...init,
    cache: 'no-store',
    headers,
  };
}

function isRootNote(event: { tags: string[][] }): boolean {
  const eTags = (event.tags || []).filter((tag) => tag[0] === 'e');
  if (eTags.length === 0) return true;
  return eTags.every((tag) => tag[3] === 'mention');
}

async function unwrap<T>(promise: Promise<Result<T, Error>>): Promise<T> {
  const result = await promise;
  if (result.isOk()) return result.value;
  throw result.error;
}

function graphqlOperationName(query: string): string {
  return query.match(/\b(?:query|mutation)\s+([A-Za-z0-9_]+)/)?.[1] ?? 'anonymous';
}

function shortId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 10) : undefined;
}

function endpointLogFields(): Record<string, unknown> {
  try {
    const url = new URL(graphqlEndpoint());
    return { host: url.host, path: url.pathname };
  } catch {
    return { endpoint: 'invalid' };
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function summarizeGraphqlInput(input: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const key of ['limit', 'offset', 'since', 'until', 'target'] as const) {
    if (input[key] !== undefined) summary[key] = input[key];
  }
  if (Array.isArray(input.kinds)) summary.kinds = input.kinds;
  if (Array.isArray(input.pubkeys)) summary.pubkeys = input.pubkeys.length;
  if (Array.isArray(input.pubkeysFrom)) summary.pubkeysFrom = input.pubkeysFrom.length;
  if (Array.isArray(input.tags)) summary.tags = input.tags.length;
  const references = objectRecord(input.references);
  if (references) {
    summary.references = {
      kinds: Array.isArray(references.kinds) ? references.kinds : undefined,
      limit: references.limit,
      since: references.since,
    };
  }
  const rankedTarget = objectRecord(input.target);
  if (rankedTarget) {
    summary.target = {
      kinds: Array.isArray(rankedTarget.kinds) ? rankedTarget.kinds : undefined,
      pubkeys: Array.isArray(rankedTarget.pubkeys) ? rankedTarget.pubkeys.length : undefined,
      pubkeysFrom: Array.isArray(rankedTarget.pubkeysFrom)
        ? rankedTarget.pubkeysFrom.length
        : undefined,
    };
  }
  const metric = objectRecord(input.metric);
  if (metric) summary.metric = metric.name;
  return summary;
}

function summarizeRankInput(rank: Record<string, unknown>): Record<string, unknown> {
  const metric = objectRecord(rank.metric);
  return {
    metric: metric?.name,
    terms: Array.isArray(rank.terms) ? rank.terms.length : 0,
    candidatePubkeyBoosts: Array.isArray(rank.candidatePubkeyBoosts)
      ? rank.candidatePubkeyBoosts.length
      : 0,
  };
}

function summarizeGraphqlVariables(variables: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const key of ['limit', 'offset', 'candidateLimit'] as const) {
    if (variables[key] !== undefined) summary[key] = variables[key];
  }
  const id = shortId(variables.id);
  if (id) summary.id = id;
  const viewerPubkey = shortId(variables.viewerPubkey);
  if (viewerPubkey) summary.viewerPubkey = viewerPubkey;
  const input = objectRecord(variables.input);
  if (input) summary.input = summarizeGraphqlInput(input);
  const rank = objectRecord(variables.rank);
  if (rank) summary.rank = summarizeRankInput(rank);
  return summary;
}

function graphqlDataKeys(value: unknown): string[] {
  const record = objectRecord(value);
  return record ? Object.keys(record).slice(0, 8) : [];
}

async function postGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
  refresh: boolean | undefined,
  controls: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<T> {
  const operationName = graphqlOperationName(query);
  const startedAt = Date.now();
  const requestFields = {
    operationName,
    refresh: !!refresh,
    timeoutMs: controls.timeoutMs,
    variables: summarizeGraphqlVariables(variables),
    ...endpointLogFields(),
  };
  let failureLogged = false;

  apiLog.info('nagg.graphql.request.start', requestFields);

  try {
    const envelope = await unwrap(
      fetchJson(
        graphqlEndpoint(),
        parseNaggGraphqlEnvelope,
        'nagg/graphql',
        withRefreshInit(
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, variables }),
          },
          refresh
        ),
        controls
      )
    );
    const durationMs = Date.now() - startedAt;
    if (envelope.errors?.length) {
      failureLogged = true;
      apiLog.error('nagg.graphql.request.graphql_error', {
        ...requestFields,
        durationMs,
        errorCount: envelope.errors.length,
        messages: envelope.errors.slice(0, 3).map((error) => error.message),
      });
      throw new Error(envelope.errors[0]?.message ?? 'GraphQL request failed');
    }
    if (!envelope.data) {
      failureLogged = true;
      apiLog.error('nagg.graphql.request.missing_data', {
        ...requestFields,
        durationMs,
      });
      throw new Error('GraphQL response did not include data');
    }
    apiLog.info('nagg.graphql.request.done', {
      ...requestFields,
      durationMs,
      dataKeys: graphqlDataKeys(envelope.data),
    });
    return envelope.data as T;
  } catch (error) {
    if (!failureLogged) {
      const params = {
        ...requestFields,
        durationMs: Date.now() - startedAt,
        error: redactError(error),
      };
      if (redactError(error).message === 'Aborted') {
        apiLog.warn('nagg.graphql.request.aborted', params);
      } else {
        apiLog.error('nagg.graphql.request.error', params);
      }
    }
    throw error;
  }
}

async function postGraphqlWithSourceAuthorFallback<T>(
  query: string,
  variables: Record<string, unknown>,
  fallbackQuery: string,
  fallbackVariables: Record<string, unknown>,
  refresh: boolean | undefined,
  controls: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<T> {
  try {
    return await postGraphql<T>(query, variables, refresh, controls);
  } catch (error) {
    if (!isSourceEventAuthorSchemaError(error)) throw error;
    apiLog.warn('nagg.graphql.source_author_fallback', {
      operationName: graphqlOperationName(query),
      fallbackOperationName: graphqlOperationName(fallbackQuery),
      reason: redactError(error),
    });
    return postGraphql<T>(fallbackQuery, fallbackVariables, refresh, controls);
  }
}

async function postGraphqlWithSourceAuthorAndTimeoutFallback<T>(
  query: string,
  variables: Record<string, unknown>,
  sourceAuthorFallbackQuery: string,
  sourceAuthorFallbackVariables: Record<string, unknown>,
  timeoutFallbackQuery: string,
  timeoutFallbackVariables: Record<string, unknown>,
  refresh: boolean | undefined,
  controls: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<T> {
  try {
    return await postGraphqlWithSourceAuthorFallback<T>(
      query,
      variables,
      sourceAuthorFallbackQuery,
      sourceAuthorFallbackVariables,
      refresh,
      controls
    );
  } catch (error) {
    if (controls.signal?.aborted || !isGraphqlTimeoutError(error)) throw error;
    apiLog.warn('nagg.graphql.timeout_fallback', {
      operationName: graphqlOperationName(query),
      fallbackOperationName: graphqlOperationName(timeoutFallbackQuery),
      reason: redactError(error),
    });
    return postGraphql<T>(timeoutFallbackQuery, timeoutFallbackVariables, refresh, controls);
  }
}

function isSourceEventAuthorSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('sourceEventAuthor') || message.includes('PubkeySourceInput');
}

function isGraphqlTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('context deadline exceeded') ||
    message.includes('deadline exceeded') ||
    message === 'Aborted'
  );
}

function feedInputFromSpec({
  spec,
  limit,
  until,
  offset,
}: {
  spec: string;
  limit: number;
  until?: number;
  offset?: number;
}): EventQueryInput {
  const parsed = parseJson<Record<string, unknown>>(spec);
  const pubkeys = pubkeysFromSpec(parsed);
  const input: EventQueryInput = {
    kinds: pubkeys.length > 0 ? [1, 6, 16] : [1],
    limit,
    ...(until && { until }),
    ...(offset && { offset }),
  };
  if (pubkeys.length > 0) input.pubkeys = pubkeys;
  return input;
}

function trendingInputFromSpec({
  parsed,
  limit,
  offset,
}: {
  parsed: Record<string, unknown> | null;
  limit: number;
  offset?: number;
}): RankedEventsInput {
  const hours = trendingHours(parsed);
  const since = Math.floor(Date.now() / 1000) - hours * 60 * 60;
  return {
    references: {
      kinds: [7],
      since,
    },
    via: { key: 'e' },
    target: { kinds: [1] },
    metric: { name: 'likers', op: 'COUNT_DISTINCT', distinctField: 'PUBKEY' },
    limit,
    ...(offset && { offset }),
  };
}

function isTrendingSpec(parsed: Record<string, unknown> | null): boolean {
  return parsed?.id === 'global-trending' && parsed.kind === 'notes';
}

function isFollowingRepliesSpec(parsed: Record<string, unknown> | null): boolean {
  return parsed?.id === 'following-replies' && parsed.kind === 'notes';
}

function isFollowingPopularSpec(parsed: Record<string, unknown> | null): boolean {
  return parsed?.id === 'following-popular' && parsed.kind === 'notes';
}

function isFollowingRecentSpec(parsed: Record<string, unknown> | null): boolean {
  return parsed?.id === 'following-recent' && parsed.kind === 'notes';
}

function followedPubkeySource(viewerPubkey: string): NonNullable<EventQueryInput['pubkeysFrom']> {
  return [
    {
      latestEventTags: {
        pubkey: viewerPubkey,
        kinds: [3],
        tag: { key: 'p' },
        limit: 1,
        maxValues: 2000,
      },
    },
  ];
}

function threadRankCandidateLimit(limit: number, offset: number): number {
  return Math.max(100, offset + limit + RELEVANT_AUTHOR_REPLY_LIMIT + 1);
}

function eventETags(event: FeedEvent): string[][] {
  return (event.tags || []).filter((tag) => tag[0] === 'e');
}

function directReplyParentId(event: FeedEvent): string | undefined {
  const eTags = eventETags(event);
  const replyTag = eTags.find((tag) => tag[3] === 'reply');
  if (replyTag?.[1]) return replyTag[1];
  const nonMentionTags = eTags.filter((tag) => tag[3] !== 'mention');
  const lastNonMentionTag = nonMentionTags[nonMentionTags.length - 1];
  if (lastNonMentionTag?.[1]) return lastNonMentionTag[1];
  return undefined;
}

function childAuthorReplyNodes(node: GraphqlEventNode | undefined): GraphqlEventNode[] {
  return node?.childAuthorReplies?.nodes ?? [];
}

function childFollowedReplyNodes(node: GraphqlEventNode | undefined): GraphqlEventNode[] {
  return node?.childFollowedReply?.nodes ?? [];
}

function collectNestedReplyNodes(
  roots: readonly GraphqlEventNode[],
  childNodesFor: (node: GraphqlEventNode) => readonly GraphqlEventNode[]
): GraphqlEventNode[] {
  const out: GraphqlEventNode[] = [];
  const seen = new Set<string>();
  const visit = (node: GraphqlEventNode | undefined): void => {
    const event = normalizeGraphqlEvent(node);
    if (!node || !event || seen.has(event.id)) return;
    seen.add(event.id);
    out.push(node);
    for (const child of childNodesFor(node)) visit(child);
  };
  for (const root of roots) visit(root);
  return out;
}

function nodeEventPairs(nodes: readonly GraphqlEventNode[]): Array<{
  node: GraphqlEventNode;
  event: FeedEvent;
}> {
  const seen = new Set<string>();
  const pairs: Array<{ node: GraphqlEventNode; event: FeedEvent }> = [];
  for (const node of nodes) {
    const event = normalizeGraphqlEvent(node);
    if (!event || seen.has(event.id)) continue;
    seen.add(event.id);
    pairs.push({ node, event });
  }
  return pairs;
}

function compareReplyPairs(a: { event: FeedEvent }, b: { event: FeedEvent }): number {
  return a.event.created_at - b.event.created_at || a.event.id.localeCompare(b.event.id);
}

function compareReplyChains(
  a: Array<{ event: FeedEvent }>,
  b: Array<{ event: FeedEvent }>
): number {
  if (a.length !== b.length) return b.length - a.length;
  const aLast = a[a.length - 1]?.event;
  const bLast = b[b.length - 1]?.event;
  if (aLast && bLast && aLast.created_at !== bLast.created_at) {
    return aLast.created_at - bLast.created_at;
  }
  const aFirst = a[0]?.event;
  const bFirst = b[0]?.event;
  if (aFirst && bFirst) return compareReplyPairs({ event: aFirst }, { event: bFirst });
  return 0;
}

function selectAuthorThreadChain({
  sourceEvent,
  authorNodes,
}: {
  sourceEvent: FeedEvent | undefined;
  authorNodes: readonly GraphqlEventNode[];
}): GraphqlEventNode[] {
  if (!sourceEvent) return [];
  const authorPairs = nodeEventPairs(
    collectNestedReplyNodes(authorNodes, childAuthorReplyNodes)
  ).filter(({ event }) => event.pubkey === sourceEvent.pubkey && event.id !== sourceEvent.id);
  const childrenByParent = new Map<string, Array<{ node: GraphqlEventNode; event: FeedEvent }>>();
  for (const pair of authorPairs) {
    const parentId = directReplyParentId(pair.event);
    if (!parentId) continue;
    const children = childrenByParent.get(parentId) ?? [];
    children.push(pair);
    childrenByParent.set(parentId, children);
  }
  for (const children of childrenByParent.values()) children.sort(compareReplyPairs);

  const bestFrom = (
    parentId: string,
    visited: ReadonlySet<string>
  ): Array<{ node: GraphqlEventNode; event: FeedEvent }> => {
    const candidates = childrenByParent.get(parentId) ?? [];
    let best: Array<{ node: GraphqlEventNode; event: FeedEvent }> = [];
    for (const candidate of candidates) {
      if (visited.has(candidate.event.id)) continue;
      const nextVisited = new Set(visited);
      nextVisited.add(candidate.event.id);
      const chain = [candidate, ...bestFrom(candidate.event.id, nextVisited)];
      if (compareReplyChains(chain, best) < 0) best = chain;
    }
    return best;
  };

  return bestFrom(sourceEvent.id, new Set([sourceEvent.id])).map(({ node }) => node);
}

function selectFollowedTailReply({
  sourceEvent,
  authorChain,
  followedNodes,
}: {
  sourceEvent: FeedEvent | undefined;
  authorChain: readonly GraphqlEventNode[];
  followedNodes: readonly GraphqlEventNode[];
}): GraphqlEventNode | undefined {
  if (!sourceEvent) return undefined;
  const tailEvent = normalizeGraphqlEvent(authorChain[authorChain.length - 1]);
  const parentId = tailEvent?.id ?? sourceEvent.id;
  const tailChildFollowedNodes =
    authorChain.length > 0 ? childFollowedReplyNodes(authorChain[authorChain.length - 1]) : [];
  const followedPairs = nodeEventPairs([
    ...followedNodes,
    ...tailChildFollowedNodes,
    ...collectNestedReplyNodes(authorChain, childFollowedReplyNodes),
  ]).filter(
    ({ event }) => event.pubkey !== sourceEvent.pubkey && directReplyParentId(event) === parentId
  );
  return followedPairs[0]?.node;
}

function mergeRelevantReplyNodes({
  sourceNode,
  authorNodes = [],
  followedNodes = [],
  rankedNodes = [],
  allNodes = [],
  offset = 0,
  limit,
}: {
  sourceNode?: GraphqlEventNode | null;
  authorNodes?: GraphqlEventNode[];
  followedNodes?: GraphqlEventNode[];
  rankedNodes?: GraphqlEventNode[];
  allNodes?: GraphqlEventNode[];
  offset?: number;
  limit?: number;
}): {
  nodes: GraphqlEventNode[];
  pageNodes: GraphqlEventNode[];
  pageEventIds: string[];
  hasMore: boolean;
} {
  const sourceEvent = normalizeGraphqlEvent(sourceNode);
  const sourceId = sourceEvent?.id;
  const seen = new Set<string>(sourceId ? [sourceId] : []);
  const merged: GraphqlEventNode[] = [];

  const append = (node: GraphqlEventNode | undefined): void => {
    const event = normalizeGraphqlEvent(node);
    if (!node || !event || seen.has(event.id)) return;
    seen.add(event.id);
    merged.push(node);
  };

  const authorThreadChain = selectAuthorThreadChain({ sourceEvent, authorNodes });
  for (const node of authorThreadChain) append(node);
  append(
    selectFollowedTailReply({
      sourceEvent,
      authorChain: authorThreadChain,
      followedNodes,
    })
  );

  for (const node of rankedNodes) append(node);
  for (const node of allNodes) append(node);

  const pageEnd = limit == null ? merged.length : offset + limit;
  const pageNodes = merged.slice(offset, pageEnd);
  return {
    nodes: merged,
    pageNodes,
    pageEventIds: pageNodes
      .map((node) => normalizeGraphqlEvent(node)?.id)
      .filter((id): id is string => !!id),
    hasMore: merged.length > pageEnd,
  };
}

function threadReplyRankInput(
  sort: ThreadReplySort,
  viewerPubkey?: string
): ReferenceRankInput | null {
  const likedByMetric: GenericMetricInput = {
    name: 'likes',
    op: 'COUNT_DISTINCT',
    distinctField: 'PUBKEY',
  };
  const repostedByMetric: GenericMetricInput = {
    name: 'reposts',
    op: 'COUNT_DISTINCT',
    distinctField: 'PUBKEY',
  };
  const zapAmountMetric: GenericMetricInput = {
    name: 'zapSats',
    op: 'SUM',
    derived: 'nip57.amount_sats',
  };
  const replyCountMetric: GenericMetricInput = {
    name: 'replies',
    op: 'COUNT_DISTINCT',
    distinctField: 'ID',
  };

  if (sort === 'new') return null;

  if (sort === 'likes') {
    return {
      references: { kinds: [7], limit: 500 },
      via: { key: 'e' },
      metric: likedByMetric,
    };
  }

  if (sort === 'zaps') {
    return {
      references: { kinds: [9735], limit: 500 },
      via: { key: 'e' },
      metric: zapAmountMetric,
    };
  }

  if (sort === 'reposts') {
    return {
      references: { kinds: [6, 16], limit: 500 },
      via: { key: 'e' },
      metric: repostedByMetric,
    };
  }

  return {
    references: { kinds: [7], limit: 500 },
    via: { key: 'e' },
    metric: likedByMetric,
    weight: 3,
    transform: 'LOG1P',
    terms: [
      {
        references: { kinds: [1, 1111], limit: 500 },
        via: { key: 'e' },
        metric: replyCountMetric,
        weight: 2.5,
        transform: 'LOG1P',
      },
      {
        references: { kinds: [6, 16], limit: 500 },
        via: { key: 'e' },
        metric: repostedByMetric,
        weight: 2,
        transform: 'LOG1P',
      },
      {
        references: { kinds: [9735], limit: 500 },
        via: { key: 'e' },
        metric: zapAmountMetric,
        weight: 1.5,
        transform: 'LOG1P',
      },
    ],
    ...(viewerPubkey
      ? {
          candidatePubkeyBoosts: [
            {
              pubkeysFrom: followedPubkeySource(viewerPubkey),
              weight: 6,
            },
          ],
        }
      : {}),
  };
}

function followingRepliesInput({
  viewerPubkey,
  limit,
  until,
  offset,
}: {
  viewerPubkey: string;
  limit: number;
  until?: number;
  offset?: number;
}): EventQueryInput {
  return {
    kinds: [1, 1111],
    tags: [{ key: 'e' }],
    pubkeysFrom: followedPubkeySource(viewerPubkey),
    limit,
    ...(until && { until }),
    ...(offset && { offset }),
  };
}

function followingRecentInput({
  viewerPubkey,
  limit,
  until,
  offset,
}: {
  viewerPubkey: string;
  limit: number;
  until?: number;
  offset?: number;
}): EventQueryInput {
  return {
    kinds: [1, 1111],
    pubkeysFrom: followedPubkeySource(viewerPubkey),
    limit,
    ...(until && { until }),
    ...(offset && { offset }),
  };
}

function followingPopularInput({
  viewerPubkey,
  parsed,
  limit,
  offset,
}: {
  viewerPubkey: string;
  parsed: Record<string, unknown> | null;
  limit: number;
  offset?: number;
}): RankedEventsInput {
  const hours = trendingHours(parsed);
  const since = Math.floor(Date.now() / 1000) - hours * 60 * 60;
  return {
    references: {
      kinds: [7],
      since,
    },
    via: { key: 'e' },
    target: {
      kinds: [1, 1111],
      pubkeysFrom: followedPubkeySource(viewerPubkey),
    },
    metric: { name: 'likers', op: 'COUNT_DISTINCT', distinctField: 'PUBKEY' },
    limit,
    ...(offset && { offset }),
  };
}

function trendingHours(parsed: Record<string, unknown> | null): number {
  const hours = typeof parsed?.hours === 'number' ? parsed.hours : 24;
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168) return 24;
  return Math.floor(hours);
}

function pubkeysFromSpec(parsed: Record<string, unknown> | null): string[] {
  if (!parsed) return [];
  const out = new Set<string>();
  if (typeof parsed.pubkey === 'string' && parsed.pubkey) out.add(parsed.pubkey);
  if (Array.isArray(parsed.pubkeys)) {
    for (const value of parsed.pubkeys) {
      if (typeof value === 'string' && value) out.add(value);
    }
  }
  return Array.from(out);
}

function mapGraphqlFeed(nodes: GraphqlEventNode[], options: FeedQueryOptions = {}) {
  return mapNaggFeedPage(graphqlNodesToNaggPage(nodes), options);
}

function mapTrendingGraphqlFeed(nodes: GraphqlEventNode[]) {
  const result = mapGraphqlFeed(nodes);
  return {
    ...result,
    paginationUntil: nodes.length > 0 ? 1 : 0,
    paginationOffset: nodes.length,
  };
}

function mapFollowingRepliesGraphqlFeed(nodes: GraphqlEventNode[]) {
  const page = graphqlNodesToNaggPage(nodes, {
    parentForNode: (node) =>
      node.rootContext?.nodes?.[0] ??
      node.parentReplyRefs?.nodes?.[0] ??
      node.parentRootRefs?.nodes?.[0] ??
      node.eventRefs?.nodes?.[0],
  });
  return mapNaggFeedPage(page);
}

function replyPreviewCount(result: FeedParseResult): number {
  let count = 0;
  for (const item of result.orderedFeedItems) {
    const previews = (item as { replyPreviewEvents?: unknown[] }).replyPreviewEvents;
    if (Array.isArray(previews)) count += previews.length;
  }
  return count;
}

function logFeedPageResult(
  source: string,
  result: FeedParseResult,
  params: Record<string, unknown>
): FeedParseResult {
  feedLog.info('feed.nagg.page.done', {
    source,
    ...params,
    items: result.orderedFeedItems.length,
    replyPreviews: replyPreviewCount(result),
    metrics: result.metricsMap.size,
    profiles: result.profilesMap.size,
    quoted: result.quotedEventsMap.size,
    missingProfiles: result.missingProfilePubkeys.length,
    missingQuoted: result.missingQuotedIds.length,
    paginationUntil: result.paginationUntil,
    paginationOffset: result.paginationOffset,
  });
  return result;
}

function graphqlNodeKindCounts(nodes: GraphqlEventNode[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const node of nodes) {
    const kind = typeof node.kind === 'number' ? String(node.kind) : 'unknown';
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}

function includeSelectedReplyNodesInThread(
  thread: ThreadStructure,
  replyNodes: readonly GraphqlEventNode[]
): ThreadStructure {
  if (!thread.target || replyNodes.length === 0) return thread;
  const existingIds = new Set([
    thread.target.id,
    ...thread.parents.map((event) => event.id),
    ...thread.replies.map((event) => event.id),
  ]);
  const selectedReplies: FeedEvent[] = [];
  for (const node of replyNodes) {
    const event = normalizeGraphqlEvent(node);
    if (!event || existingIds.has(event.id)) continue;
    existingIds.add(event.id);
    selectedReplies.push(event);
  }
  if (selectedReplies.length === 0) return thread;
  return {
    ...thread,
    replies: [...thread.replies, ...selectedReplies],
  };
}

function graphqlNodesToNaggPage(
  nodes: GraphqlEventNode[],
  options: { parentForNode?: (node: GraphqlEventNode) => GraphqlEventNode | undefined } = {}
): NaggFeedResponseData {
  const metrics: Record<string, NoteMetrics> = {};
  const profiles: Record<string, ProfileInfo> = {};
  const quoted: Record<string, FeedEvent> = {};
  const items: unknown[] = [];
  let paginationUntil = 0;

  const hydrate = (node: GraphqlEventNode | undefined) => {
    if (!node) return;
    const event = normalizeGraphqlEvent(node);
    if (!event) return;
    metrics[event.id] = metricsFromGraphqlNode(node);
    const profile = profileFromMetadataEvent(node.authorMetadata?.[0]);
    if (profile) profiles[event.pubkey] = profile;
    for (const quoteNode of node.quotedContent?.nodes ?? []) {
      const quote = normalizeGraphqlEvent(quoteNode);
      if (!quote) continue;
      quoted[quote.id] = quote;
      hydrate(quoteNode);
    }
  };

  for (const node of nodes) {
    const event = normalizeGraphqlEvent(node);
    if (!event) continue;
    hydrate(node);
    paginationUntil =
      paginationUntil === 0 ? event.created_at : Math.min(paginationUntil, event.created_at);

    const eventRefs = (node.eventRefs?.nodes ?? []).map(normalizeGraphqlEvent).filter(Boolean);
    const explicitParent = normalizeGraphqlEvent(options.parentForNode?.(node));
    const resolvedRoot = normalizeGraphqlEvent(node.rootContext?.nodes?.[0]);
    const rootEvent =
      explicitParent ??
      (resolvedRoot && resolvedRoot.id !== event.id ? resolvedRoot : undefined) ??
      eventRefs.find((ref) => ref && ref.id !== event.id) ??
      undefined;
    for (const refNode of node.eventRefs?.nodes ?? []) hydrate(refNode);
    for (const refNode of node.parentReplyRefs?.nodes ?? []) hydrate(refNode);
    for (const refNode of node.parentRootRefs?.nodes ?? []) hydrate(refNode);
    for (const refNode of node.rootContext?.nodes ?? []) hydrate(refNode);
    const replyPreviewNodes = mergeRelevantReplyNodes({
      sourceNode: node,
      authorNodes: node.authorReplies?.nodes,
      followedNodes: node.followedReply?.nodes,
    }).nodes;
    for (const replyNode of replyPreviewNodes) hydrate(replyNode);
    const replyPreviewEvents = replyPreviewNodes
      .map(normalizeGraphqlEvent)
      .filter((replyEvent): replyEvent is FeedEvent => !!replyEvent && replyEvent.id !== event.id);

    if (event.kind === 6 || event.kind === 16) {
      const originalEvent = eventRefs[0] ?? undefined;
      const originalEventId = originalEvent?.id ?? getFirstTagValue(event, 'e') ?? '';
      if (!originalEventId) continue;
      items.push({
        type: 'repost',
        repostEvent: event,
        originalEvent,
        originalEventId,
        rootEvent,
        rootEventId: rootEvent?.id,
      });
      continue;
    }

    items.push({
      type: 'note',
      event,
      rootEvent,
      rootEventId: rootEvent?.id,
      ...(replyPreviewEvents.length > 0 ? { replyPreviewEvents } : {}),
    });
  }

  return {
    items,
    metrics,
    profiles,
    quoted,
    paginationUntil,
    paginationOffset: nodes.length,
  } as unknown as NaggFeedResponseData;
}

function normalizeGraphqlEvent(node: GraphqlEventNode | null | undefined): FeedEvent | undefined {
  if (!node || typeof node.id !== 'string' || typeof node.pubkey !== 'string') return undefined;
  if (
    typeof node.kind !== 'number' ||
    typeof node.content !== 'string' ||
    !Array.isArray(node.tags)
  ) {
    return undefined;
  }
  return {
    id: node.id,
    pubkey: node.pubkey,
    kind: node.kind,
    content: node.content,
    tags: node.tags.filter(Array.isArray),
    created_at: createdAtSeconds(node.createdAt),
  };
}

function profileFromMetadataEvent(node: GraphqlEventNode | undefined): ProfileInfo | undefined {
  if (!node || node.kind !== 0) return undefined;
  const parsed = parseJson<Record<string, unknown>>(node.content);
  if (!parsed) return undefined;
  const displayName = stringField(parsed.display_name) ?? stringField(parsed.displayName);
  const name = displayName ?? stringField(parsed.name) ?? '';
  const picture = stringField(parsed.picture) ?? stringField(parsed.image);
  return { name, ...(picture ? { picture } : {}) };
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function metricsFromGraphqlNode(node: GraphqlEventNode): NoteMetrics {
  return {
    likeCount: aggregateMetric(node.likes, 'pubkeys'),
    repostCount: aggregateMetric(node.reposts, 'pubkeys'),
    replyCount: aggregateMetric(node.replyStats, 'events'),
    satsZapped: aggregateMetric(node.zaps, 'amountSats'),
  };
}

function aggregateMetric(aggregate: GraphqlAggregate | undefined, key: string): number {
  const value = aggregate?.rows?.[0]?.metrics?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function createdAtSeconds(value: string | number | Date): number {
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  if (typeof value === 'number')
    return value > 1_000_000_000_000 ? Math.floor(value / 1000) : value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function collectHydrationFromGraphqlNodes(nodes: GraphqlEventNode[]): {
  metrics: Map<string, NoteMetrics>;
  profiles: Map<string, ProfileInfo>;
  quotedEvents: Map<string, FeedEvent>;
} {
  const page = graphqlNodesToNaggPage(nodes);
  return {
    metrics: new Map(Object.entries(page.metrics)),
    profiles: new Map(Object.entries(page.profiles)),
    quotedEvents: new Map(Object.entries(page.quoted)),
  };
}

function addThreadNode(
  node: GraphqlEventNode | undefined,
  buckets: {
    allEvents: Map<string, FeedEvent>;
    profiles: Map<string, ProfileInfo>;
    metrics: Map<string, NoteMetrics>;
    quotedEvents: Map<string, FeedEvent>;
  }
) {
  const event = normalizeGraphqlEvent(node);
  if (!node || !event) return;
  buckets.allEvents.set(event.id, event);
  buckets.metrics.set(event.id, metricsFromGraphqlNode(node));
  const profile = profileFromMetadataEvent(node.authorMetadata?.[0]);
  if (profile) buckets.profiles.set(event.pubkey, profile);
  for (const quoteNode of node.quotedContent?.nodes ?? []) {
    const quote = normalizeGraphqlEvent(quoteNode);
    if (quote) buckets.quotedEvents.set(quote.id, quote);
    addThreadNode(quoteNode, buckets);
  }
  for (const childNode of node.childAuthorReplies?.nodes ?? []) addThreadNode(childNode, buckets);
  for (const childNode of node.childFollowedReply?.nodes ?? []) addThreadNode(childNode, buckets);
}

export function createNaggFeedClient(): FeedClient {
  return {
    async getFeed({
      spec,
      userPubkey,
      limit = 30,
      until,
      offset,
      refresh,
      signal,
      timeoutMs,
    }: FeedPageRequest) {
      const startedAt = Date.now();
      const logResult = (source: string, result: FeedParseResult): FeedParseResult =>
        logFeedPageResult(source, result, {
          limit,
          until,
          offset,
          refresh: !!refresh,
          viewerPubkey: !!userPubkey,
          durationMs: Date.now() - startedAt,
        });
      const hydratedSpec = hydrateSpecWithPubkey(spec, userPubkey);
      if (hasEmptyExplicitPubkeys(hydratedSpec)) {
        return logResult('empty-explicit-pubkeys', emptyFeedParseResult());
      }
      const parsedSpec = parseJson<Record<string, unknown>>(hydratedSpec);
      if (isTrendingSpec(parsedSpec)) {
        const variables = {
          input: trendingInputFromSpec({ parsed: parsedSpec, limit, offset }),
          ...(userPubkey ? { viewerPubkey: userPubkey } : {}),
        };
        const data = userPubkey
          ? await postGraphqlWithSourceAuthorAndTimeoutFallback<GraphqlFeedData>(
              TRENDING_FEED_WITH_VIEWER_QUERY,
              variables,
              TRENDING_FEED_WITH_VIEWER_LEGACY_QUERY,
              variables,
              TRENDING_FEED_QUERY,
              { input: variables.input },
              refresh,
              { signal, timeoutMs }
            )
          : await postGraphql<GraphqlFeedData>(TRENDING_FEED_QUERY, variables, refresh, {
              signal,
              timeoutMs,
            });
        return logResult('global-trending', mapTrendingGraphqlFeed(data.rankedEvents?.nodes ?? []));
      }
      if (isFollowingRepliesSpec(parsedSpec)) {
        if (!userPubkey) return logResult('following-replies-no-viewer', emptyFeedParseResult());
        const data = await postGraphql<GraphqlFeedData>(
          FOLLOWING_REPLIES_QUERY,
          { input: followingRepliesInput({ viewerPubkey: userPubkey, limit, until, offset }) },
          refresh,
          { signal, timeoutMs }
        );
        return logResult(
          'following-replies',
          mapFollowingRepliesGraphqlFeed(data.events?.nodes ?? [])
        );
      }
      if (isFollowingPopularSpec(parsedSpec)) {
        if (!userPubkey) return logResult('following-popular-no-viewer', emptyFeedParseResult());
        const variables = {
          input: followingPopularInput({
            viewerPubkey: userPubkey,
            parsed: parsedSpec,
            limit,
            offset,
          }),
          viewerPubkey: userPubkey,
        };
        const data = await postGraphqlWithSourceAuthorAndTimeoutFallback<GraphqlFeedData>(
          FOLLOWING_POPULAR_WITH_VIEWER_QUERY,
          variables,
          FOLLOWING_POPULAR_WITH_VIEWER_LEGACY_QUERY,
          variables,
          FOLLOWING_POPULAR_QUERY,
          { input: variables.input },
          refresh,
          { signal, timeoutMs }
        );
        return logResult(
          'following-popular',
          mapTrendingGraphqlFeed(data.rankedEvents?.nodes ?? [])
        );
      }
      if (isFollowingRecentSpec(parsedSpec)) {
        if (!userPubkey) return logResult('following-recent-no-viewer', emptyFeedParseResult());
        const data = await postGraphql<GraphqlFeedData>(
          FEED_QUERY,
          { input: followingRecentInput({ viewerPubkey: userPubkey, limit, until, offset }) },
          refresh,
          { signal, timeoutMs }
        );
        return logResult('following-recent', mapGraphqlFeed(data.events?.nodes ?? []));
      }
      const data = await postGraphql<GraphqlFeedData>(
        FEED_QUERY,
        { input: feedInputFromSpec({ spec: hydratedSpec, limit, until, offset }) },
        refresh,
        { signal, timeoutMs }
      );
      return logResult('generic', mapGraphqlFeed(data.events?.nodes ?? []));
    },

    async getUserFeed({
      pubkey,
      authorName,
      authorPicture,
      limit = 50,
      until,
      offset,
      refresh,
      signal,
      timeoutMs,
    }: UserFeedPageRequest) {
      const data = await postGraphql<GraphqlFeedData>(
        FEED_QUERY,
        {
          input: {
            pubkeys: [pubkey],
            kinds: [1, 6, 16],
            limit,
            ...(until && { until }),
            ...(offset && { offset }),
          },
        },
        refresh,
        { signal, timeoutMs }
      );
      return mapGraphqlFeed(data.events?.nodes ?? [], {
        includeNote: (event) => event.pubkey === pubkey && isRootNote(event),
        includeRepost: (event) => event.pubkey === pubkey,
        extraProfile: authorName
          ? { pubkey, profile: { name: authorName, picture: authorPicture } }
          : undefined,
      });
    },

    async enrich({
      missingQuotedIds,
      missingProfilePubkeys,
      refresh,
      signal,
      timeoutMs,
    }: FeedEnrichmentRequest): Promise<FeedEnrichmentUpdates> {
      const tasks: Promise<FeedEnrichmentUpdates>[] = [];

      if (missingQuotedIds.length > 0) {
        tasks.push(
          postGraphql<GraphqlFeedData>(
            ENRICH_EVENTS_QUERY,
            { input: { ids: missingQuotedIds, limit: missingQuotedIds.length } },
            refresh,
            { signal, timeoutMs }
          ).then((data) => collectHydrationFromGraphqlNodes(data.events?.nodes ?? []))
        );
      }

      if (missingProfilePubkeys.length > 0) {
        tasks.push(
          postGraphql<GraphqlFeedData>(
            PROFILE_EVENTS_QUERY,
            {
              input: {
                pubkeys: missingProfilePubkeys,
                kinds: [0],
                limit: missingProfilePubkeys.length,
              },
            },
            refresh,
            { signal, timeoutMs }
          ).then((data) => {
            const profiles = new Map<string, ProfileInfo>();
            for (const node of data.events?.nodes ?? []) {
              const profile = profileFromMetadataEvent(node);
              if (profile) profiles.set(node.pubkey, profile);
            }
            return { profiles };
          })
        );
      }

      const responses = await Promise.all(tasks);
      const updates: FeedEnrichmentUpdates = {};
      for (const response of responses) {
        if (response.quotedEvents) {
          updates.quotedEvents ??= new Map();
          for (const [key, value] of response.quotedEvents) updates.quotedEvents.set(key, value);
        }
        if (response.metrics) {
          updates.metrics ??= new Map();
          for (const [key, value] of response.metrics) updates.metrics.set(key, value);
        }
        if (response.profiles) {
          updates.profiles ??= new Map();
          for (const [key, value] of response.profiles) updates.profiles.set(key, value);
        }
      }

      return updates;
    },

    async getThread({
      eventId,
      limit = 10,
      offset = 0,
      sort = 'relevant',
      viewerPubkey,
      seed,
      signal,
      timeoutMs,
    }: ThreadRequest): Promise<ThreadResult> {
      const startedAt = Date.now();
      const rank = threadReplyRankInput(sort, viewerPubkey);
      const isRelevantSort = sort === 'relevant' && !!rank;
      const candidateLimit = threadRankCandidateLimit(limit, offset);
      const rankedLimit = Math.min(candidateLimit, 50);
      const query = isRelevantSort
        ? THREAD_RELEVANT_QUERY
        : rank
          ? THREAD_RANKED_QUERY
          : THREAD_NEW_QUERY;
      const variables = isRelevantSort
        ? {
            id: eventId,
            candidateLimit,
            rankedLimit,
            rank,
            viewerPubkey: viewerPubkey ?? '',
          }
        : rank
          ? {
              id: eventId,
              limit,
              offset,
              candidateLimit,
              rank,
            }
          : { id: eventId, limit, offset };
      const fallbackVariables =
        isRelevantSort && rank
          ? {
              id: eventId,
              limit,
              offset,
              candidateLimit,
              rank,
            }
          : variables;
      const data = isRelevantSort
        ? await postGraphqlWithSourceAuthorFallback<GraphqlThreadData>(
            query,
            variables,
            THREAD_RANKED_QUERY,
            fallbackVariables,
            false,
            { signal, timeoutMs }
          )
        : await postGraphql<GraphqlThreadData>(query, variables, false, {
            signal,
            timeoutMs,
          });

      const rankedReplyNodes = data.event?.replies?.nodes ?? [];
      const allReplyNodes = data.event?.allReplies?.nodes ?? [];
      const supportsSourceAuthorReplies = isRelevantSort && !!data.event?.authorReplies;
      const relevantReplies = supportsSourceAuthorReplies
        ? mergeRelevantReplyNodes({
            sourceNode: data.event,
            authorNodes: data.event?.authorReplies?.nodes,
            followedNodes: data.event?.followedReply?.nodes,
            rankedNodes: rankedReplyNodes,
            allNodes: allReplyNodes,
            offset,
            limit,
          })
        : null;
      const replyNodes = relevantReplies?.pageNodes ?? rankedReplyNodes;
      const replyPageEventIds =
        relevantReplies?.pageEventIds ??
        replyNodes
          .map((node) => normalizeGraphqlEvent(node)?.id)
          .filter((id): id is string => !!id);
      const buckets = {
        allEvents: seed ? new Map(seed.allEvents) : new Map<string, FeedEvent>(),
        profiles: seed ? new Map(seed.profiles) : new Map<string, ProfileInfo>(),
        metrics: seed ? new Map(seed.metrics) : new Map<string, NoteMetrics>(),
        quotedEvents: seed ? new Map(seed.quotedEvents) : new Map<string, FeedEvent>(),
      };
      addThreadNode(data.event ?? undefined, buckets);
      for (const parent of data.event?.parentRefs?.nodes ?? []) addThreadNode(parent, buckets);
      if (supportsSourceAuthorReplies) {
        for (const reply of data.event?.authorReplies?.nodes ?? []) addThreadNode(reply, buckets);
        for (const reply of data.event?.followedReply?.nodes ?? []) addThreadNode(reply, buckets);
        for (const reply of rankedReplyNodes) addThreadNode(reply, buckets);
        for (const reply of allReplyNodes) addThreadNode(reply, buckets);
      } else {
        for (const reply of replyNodes) addThreadNode(reply, buckets);
      }

      const thread = includeSelectedReplyNodesInThread(
        buildThreadStructure(eventId, buckets.allEvents),
        replyNodes
      );
      const hasMoreReplies = relevantReplies
        ? relevantReplies.hasMore || allReplyNodes.length >= candidateLimit
        : replyNodes.length >= limit;
      const targetMetrics = buckets.metrics.get(eventId);

      feedLog.info('thread.nagg.graphql.result', {
        eventId,
        sort,
        limit,
        offset,
        candidateLimit,
        rankedLimit,
        query: graphqlOperationName(query),
        durationMs: Date.now() - startedAt,
        seedEvents: seed?.allEvents.size ?? 0,
        allEvents: buckets.allEvents.size,
        replyNodeCount: replyNodes.length,
        rankedReplyNodeCount: rankedReplyNodes.length,
        allReplyNodeCount: allReplyNodes.length,
        authorReplyNodeCount: data.event?.authorReplies?.nodes?.length ?? 0,
        followedReplyNodeCount: data.event?.followedReply?.nodes?.length ?? 0,
        supportsSourceAuthorReplies,
        replyPageEventIds: replyPageEventIds.map(shortId),
        replyNodeKinds: graphqlNodeKindCounts(replyNodes),
        renderedReplies: thread.replies.length,
        targetReplyCount: targetMetrics?.replyCount ?? null,
        hasMoreReplies,
      });

      return {
        ...buckets,
        thread,
        replyPageEventIds,
        replyPageSize: limit,
        loadedReplyCount: replyPageEventIds.length,
        hasMoreReplies,
      };
    },
  };
}
