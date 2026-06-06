import {
  createNaggClient,
  NAGG_CAPABILITIES,
  NaggFeedPageSchema,
  NaggNotificationsPageSchema,
  NaggUnknownDataSchema,
  type NaggAppViewBinding,
  type NaggCapability,
  type NaggError,
  type NaggNotificationsPage,
} from '@sovranbitcoin/nagg-ts';
import {
  authoredReplyChainInput,
  followingRecentEventsInput,
  followingRepliesEventsInput,
  followingPopularRankedEventsInput,
  followsFeedAppView,
  forYouRankedEventsInput,
  mergeRelevantReplyNodes as mergeNaggRelevantReplyNodes,
  notificationsAppView,
  notificationsInput,
  rankedFeedAppView,
  recentNotesEventsInput,
  threadReplyRankInput as buildThreadReplyRankInput,
  userFeedAppView,
  withEventExclusions,
  withRankedTargetExclusions,
  type EventQueryInput,
  type RankedEventsInput,
  type ReferenceRankInput,
} from '@sovranbitcoin/nagg-ts/recipes';
import {
  graphqlNodesToNaggPage,
  metricsFromGraphqlNode,
  normalizeGraphqlEvent,
  profileFromMetadataEvent,
  type NaggFeedPage,
  type NaggGraphqlConnection as GraphqlConnection,
  type NaggGraphqlEventNode as GraphqlEventNode,
} from '@sovranbitcoin/nagg-ts/map';
import type { z } from 'zod';
import { backendConfig } from '@/shared/config/backend';
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
  FeedNotificationsRequest,
  FeedNotificationsResult,
  ThreadRequest,
  ThreadReplySort,
  ThreadResult,
  UserFeedPageRequest,
  PostsByPubkeysRequest,
} from './feedClient';
import { emptyFeedParseResult } from './feedClient';
import { hasEmptyExplicitPubkeys, hydrateSpecWithPubkey } from './feedSpec';
import { parseJson } from '../components/nostr/feedParse';
import type { FeedEvent, NoteMetrics, ProfileInfo } from '../components/nostr/feedTypes';
import { useFeedIgnoreStore } from '../stores/ignoreStore';

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

const NOTIFICATION_EVENT_REFS_SELECTION = `
  eventRefs: selectedReferences(input: { fallback: { key: "e" }, limit: 8 }) {
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

const RANKED_FEED_QUERY = `
query NaggGraphqlRankedFeed($input: RankedEventsInput!) {
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

const RANKED_FEED_WITH_VIEWER_QUERY = `
query NaggGraphqlRankedFeed($input: RankedEventsInput!, $viewerPubkey: String!, $authorChain: AuthoredReplyChainInput!) {
  rankedEvents(input: $input) {
    nodes {
      ${BASE_EVENT_SELECTION}
      ${AUTHOR_METADATA_SELECTION}
      ${ROOT_CONTEXT_SELECTION}
      ${EVENT_REFS_SELECTION}
      ${QUOTED_CONTENT_SELECTION}
      authorReplies: authoredReplyChain(input: $authorChain) {
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

const RANKED_FEED_WITH_VIEWER_LEGACY_QUERY = `
query NaggGraphqlRankedFeed($input: RankedEventsInput!, $viewerPubkey: String!) {
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

const FOLLOWING_POPULAR_WITH_VIEWER_QUERY = `
query NaggGraphqlFollowingPopular($input: RankedEventsInput!, $viewerPubkey: String!, $authorChain: AuthoredReplyChainInput!) {
  rankedEvents(input: $input) {
    nodes {
      ${BASE_EVENT_SELECTION}
      ${AUTHOR_METADATA_SELECTION}
      ${ROOT_CONTEXT_SELECTION}
      ${EVENT_REFS_SELECTION}
      ${QUOTED_CONTENT_SELECTION}
      authorReplies: authoredReplyChain(input: $authorChain) {
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

const NOTIFICATIONS_QUERY = `
query NaggGraphqlNotifications($input: NotificationInput!) {
  notifications(input: $input) {
    nodes {
      reason
      actorVertexScore
      event {
        ${BASE_EVENT_SELECTION}
        ${AUTHOR_METADATA_SELECTION}
        ${ROOT_CONTEXT_SELECTION}
        ${NOTIFICATION_EVENT_REFS_SELECTION}
        ${QUOTED_CONTENT_SELECTION}
        ${METRIC_SELECTION}
      }
    }
    pageInfo { endCursor hasNextPage }
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
  authorReplies: authoredReplyChain(input: $authorChain) {
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
  $authorChain: AuthoredReplyChainInput!
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

type GraphqlFeedData = {
  events?: GraphqlConnection<GraphqlEventNode>;
  rankedEvents?: GraphqlConnection<GraphqlEventNode>;
};

type GraphqlNotificationNode = {
  reason?: string | null;
  actorVertexScore?: number | null;
  event?: GraphqlEventNode | null;
};

type GraphqlNotificationsData = {
  notifications?: GraphqlConnection<GraphqlNotificationNode>;
};

type GraphqlThreadData = {
  event?: GraphqlEventNode | null;
};

type FeedQueryOptions = {
  includeNote?: (event: FeedEvent, rootEvent?: FeedEvent) => boolean;
  includeRepost?: (event: FeedEvent, originalEvent?: FeedEvent, rootEvent?: FeedEvent) => boolean;
  extraProfile?: { pubkey: string; profile: ProfileInfo };
};

function graphqlEndpoint(): string {
  return backendConfig.nostrGraphqlEndpoint;
}

function isRootNote(event: { tags: string[][] }): boolean {
  const eTags = (event.tags || []).filter((tag) => tag[0] === 'e');
  if (eTags.length === 0) return true;
  return eTags.every((tag) => tag[3] === 'mention');
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

function dataKeysOf(value: unknown): string[] {
  const record = objectRecord(value);
  return record ? Object.keys(record).slice(0, 8) : [];
}

/**
 * One transport-agnostic request per view. The caller supplies the canonical
 * `dataSchema` plus the GraphQL distiller (`graphqlToData`) and the REST app-view
 * `appView` binding; `transport` (derived from a feature flag) selects the URL.
 *
 * - `transport: 'graphql'` → POST the GraphQL endpoint, distil `data` with
 *   `graphqlToData`, then `dataSchema.safeParse`.
 * - `transport: 'appview'` (with a binding) → GET/POST the REST route; the body
 *   is already canonical, so `dataSchema.safeParse` runs with no distill step.
 *
 * Both branches return the SAME parsed canonical type — there is no
 * per-transport fork at the call site, only a different URL.
 */
type NaggQueryOptions<TSchema extends z.ZodType> = {
  dataSchema: TSchema;
  graphqlToData?: (data: unknown) => unknown;
  appView?: NaggAppViewBinding;
  transport?: 'graphql' | 'appview';
  signal?: AbortSignal;
  timeoutMs?: number;
};

async function runNaggQuery<TSchema extends z.ZodType>(
  query: string,
  variables: Record<string, unknown>,
  refresh: boolean | undefined,
  options: NaggQueryOptions<TSchema>
): Promise<z.infer<TSchema>> {
  const operationName = options.appView?.operationName ?? graphqlOperationName(query);
  // App-view only when explicitly selected AND a binding exists; otherwise the
  // nagg client falls through to GraphQL (so the switch degrades per-query).
  const transport = options.transport === 'appview' && options.appView ? 'appview' : 'graphql';
  const startedAt = Date.now();
  const requestFields = {
    operationName,
    refresh: !!refresh,
    timeoutMs: options.timeoutMs,
    transport,
    variables: summarizeGraphqlVariables(variables),
    ...endpointLogFields(),
  };

  logBackendConfigOnce();
  apiLog.info('nagg.graphql.request.start', requestFields);

  const client = createNaggClient({
    endpoint: graphqlEndpoint(),
    appView: { baseUrl: backendConfig.nostrAppViewBaseUrl, version: 'v1' },
  });
  const result = await client.query({
    query,
    variables,
    operationName,
    dataSchema: options.dataSchema,
    graphqlToData: options.graphqlToData,
    transport,
    appView: options.appView,
    refresh,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
  const durationMs = Date.now() - startedAt;

  if (result.isErr()) {
    const error = result.error;
    if (error.type === 'graphql') {
      apiLog.error('nagg.graphql.request.graphql_error', {
        ...requestFields,
        durationMs,
        errorCount: error.errors.length,
        messages: error.errors.slice(0, 3).map((graphqlError) => graphqlError.message),
      });
    } else if (error.type === 'missing_data') {
      apiLog.error('nagg.graphql.request.missing_data', {
        ...requestFields,
        durationMs,
      });
    } else if (error.type === 'schema') {
      // The canonical shape failed `dataSchema.safeParse` — this is the prime
      // suspect for an EMPTY feed/notifications: the request succeeded but the
      // client rejected the payload, so nothing reaches the UI. Log the exact
      // failing field(s) so we can see which part of the live data the schema
      // rejected.
      apiLog.error('nagg.graphql.request.schema_error', {
        ...requestFields,
        durationMs,
        issueCount: error.issues?.length ?? 0,
        issues: (error.issues ?? []).slice(0, 10).map((issue) => ({
          path: Array.isArray(issue.path)
            ? issue.path.join('.')
            : String((issue as { path?: unknown }).path ?? ''),
          code: issue.code,
          message: issue.message,
        })),
      });
    } else {
      const thrown = errorFromNaggError(error);
      const params = {
        ...requestFields,
        durationMs,
        error: redactError(thrown),
      };
      if (redactError(thrown).message === 'Aborted') {
        apiLog.warn('nagg.graphql.request.aborted', params);
      } else {
        apiLog.error('nagg.graphql.request.error', params);
      }
    }
    throw errorFromNaggError(error);
  }

  apiLog.info('nagg.graphql.request.done', {
    ...requestFields,
    durationMs,
    dataKeys: dataKeysOf(result.value),
    resultCount: countCanonical(result.value),
  });
  return result.value;
}

// Logs the resolved backend config once per session: the endpoint + which
// transport each view uses (GraphQL vs REST app-view). If feeds are empty
// because a flag is unexpectedly enabling the REST path, this surfaces it.
let loggedBackendConfig = false;
function logBackendConfigOnce(): void {
  if (loggedBackendConfig) return;
  loggedBackendConfig = true;
  apiLog.info('nagg.backend.config', {
    graphqlEndpoint: backendConfig.nostrGraphqlEndpoint,
    appViewBaseUrl: backendConfig.nostrAppViewBaseUrl,
    feedAppView: backendConfig.nostrFeedAppView,
    notificationsAppView: backendConfig.nostrNotificationsAppView,
    dmAppView: backendConfig.nostrDmAppView,
  });
}

// Counts the rows in a parsed canonical payload (feed items / notification nodes
// / thread events) for log diagnostics — distinguishes "request returned data"
// from "request returned an empty page".
function countCanonical(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const v = value as {
    items?: unknown[];
    notifications?: { nodes?: unknown[] };
    events?: unknown[];
  };
  if (Array.isArray(v.items)) return v.items.length;
  if (v.notifications && Array.isArray(v.notifications.nodes)) return v.notifications.nodes.length;
  if (Array.isArray(v.events)) return v.events.length;
  return 0;
}

/**
 * The feed seam: resolve a query to a parsed {@link NaggFeedPage} regardless of
 * transport. GraphQL distils its node tree with `graphqlToData`; the app-view
 * returns the canonical page directly. Both end at `NaggFeedPageSchema` and feed
 * straight into `mapNaggFeedPage`.
 */
function fetchNaggFeedPage(
  query: string,
  variables: Record<string, unknown>,
  refresh: boolean | undefined,
  options: {
    graphqlToData: (data: unknown) => unknown;
    appView?: NaggAppViewBinding;
    transport?: 'graphql' | 'appview';
    signal?: AbortSignal;
    timeoutMs?: number;
  }
): Promise<NaggFeedPage<FeedEvent, ProfileInfo>> {
  return runNaggQuery(query, variables, refresh, {
    dataSchema: NaggFeedPageSchema,
    graphqlToData: options.graphqlToData,
    appView: options.appView,
    transport: options.transport,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  }) as Promise<NaggFeedPage<FeedEvent, ProfileInfo>>;
}

/** The flag-derived transport for feed/thread views. */
function feedTransport(): 'graphql' | 'appview' {
  return backendConfig.nostrFeedAppView ? 'appview' : 'graphql';
}

function errorFromNaggError(error: NaggError): Error {
  const out = new Error(error.message);
  out.name =
    error.type === 'network' && /abort|timed out|timeout/i.test(error.message)
      ? 'AbortError'
      : 'NaggGraphqlError';
  return out;
}

const unsupportedGraphqlCapabilities = new Set<NaggCapability>();

/**
 * A `runNaggQuery` invocation that can stand in for the primary or a fallback.
 * Fallbacks are always GraphQL-only (no app-view binding), so they re-derive the
 * canonical shape from the lighter GraphQL query via the same `graphqlToData`.
 */
type NaggQueryAttempt = {
  query: string;
  variables: Record<string, unknown>;
  appView?: NaggAppViewBinding;
  transport?: 'graphql' | 'appview';
};

async function postGraphqlWithCapabilityFallback<TSchema extends z.ZodType>({
  capability,
  primary,
  fallback,
  refresh,
  controls,
  isCapabilityError,
}: {
  capability: NaggCapability;
  primary: NaggQueryAttempt;
  fallback: NaggQueryAttempt;
  refresh: boolean | undefined;
  controls: { dataSchema: TSchema; graphqlToData: (data: unknown) => unknown } & {
    signal?: AbortSignal;
    timeoutMs?: number;
  };
  isCapabilityError: (error: unknown) => boolean;
}): Promise<z.infer<TSchema>> {
  const run = (attempt: NaggQueryAttempt): Promise<z.infer<TSchema>> =>
    runNaggQuery(attempt.query, attempt.variables, refresh, {
      dataSchema: controls.dataSchema,
      graphqlToData: controls.graphqlToData,
      appView: attempt.appView,
      transport: attempt.transport,
      signal: controls.signal,
      timeoutMs: controls.timeoutMs,
    });

  if (unsupportedGraphqlCapabilities.has(capability)) {
    apiLog.warn('nagg.graphql.capability_fallback', {
      capability,
      operationName: graphqlOperationName(primary.query),
      fallbackOperationName: graphqlOperationName(fallback.query),
      reason: 'cached_unsupported_capability',
    });
    return run(fallback);
  }

  try {
    return await run(primary);
  } catch (error) {
    if (!isCapabilityError(error)) throw error;
    unsupportedGraphqlCapabilities.add(capability);
    apiLog.warn('nagg.graphql.capability_fallback', {
      capability,
      operationName: graphqlOperationName(primary.query),
      fallbackOperationName: graphqlOperationName(fallback.query),
      reason: redactError(error),
    });
    return run(fallback);
  }
}

async function postGraphqlWithAuthorReplyFallback<TSchema extends z.ZodType>(
  primary: NaggQueryAttempt,
  fallback: NaggQueryAttempt,
  refresh: boolean | undefined,
  controls: { dataSchema: TSchema; graphqlToData: (data: unknown) => unknown } & {
    signal?: AbortSignal;
    timeoutMs?: number;
  }
): Promise<z.infer<TSchema>> {
  return postGraphqlWithCapabilityFallback({
    capability: NAGG_CAPABILITIES.AUTHORED_REPLY_CHAIN,
    primary,
    fallback,
    refresh,
    controls,
    isCapabilityError: isAuthorReplyCapabilityError,
  });
}

async function postGraphqlWithAuthorReplyAndTimeoutFallback<TSchema extends z.ZodType>(
  primary: NaggQueryAttempt,
  authorReplyFallback: NaggQueryAttempt,
  timeoutFallback: NaggQueryAttempt,
  refresh: boolean | undefined,
  controls: { dataSchema: TSchema; graphqlToData: (data: unknown) => unknown } & {
    signal?: AbortSignal;
    timeoutMs?: number;
  }
): Promise<z.infer<TSchema>> {
  try {
    return await postGraphqlWithAuthorReplyFallback(
      primary,
      authorReplyFallback,
      refresh,
      controls
    );
  } catch (error) {
    if (controls.signal?.aborted || !isGraphqlTimeoutError(error)) throw error;
    apiLog.warn('nagg.graphql.timeout_fallback', {
      operationName: graphqlOperationName(primary.query),
      fallbackOperationName: graphqlOperationName(timeoutFallback.query),
      reason: redactError(error),
    });
    return runNaggQuery(timeoutFallback.query, timeoutFallback.variables, refresh, {
      dataSchema: controls.dataSchema,
      graphqlToData: controls.graphqlToData,
      appView: timeoutFallback.appView,
      transport: timeoutFallback.transport,
      signal: controls.signal,
      timeoutMs: controls.timeoutMs,
    });
  }
}

/**
 * Thread is the documented exception to "prefer app-view": nagg's REST
 * `/nostr/thread` cannot reproduce the viewer-specific relevance ranking
 * (`authoredReplyChain` + `rankedReferencedBy` over the follow graph) that the
 * GraphQL thread relies on. So the thread path stays GraphQL-only and consumes
 * the raw GraphQL node tree directly — `runNaggQuery` with the passthrough
 * `NaggUnknownDataSchema` and no app-view binding gives us that raw tree while
 * reusing the shared client/logging.
 */
function postGraphqlThread<T>(
  query: string,
  variables: Record<string, unknown>,
  refresh: boolean | undefined,
  controls: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<T> {
  return runNaggQuery(query, variables, refresh, {
    dataSchema: NaggUnknownDataSchema,
    signal: controls.signal,
    timeoutMs: controls.timeoutMs,
  }) as Promise<T>;
}

async function postGraphqlThreadWithAuthorReplyFallback<T>(
  query: string,
  variables: Record<string, unknown>,
  fallbackQuery: string,
  fallbackVariables: Record<string, unknown>,
  refresh: boolean | undefined,
  controls: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<T> {
  const capability = NAGG_CAPABILITIES.AUTHORED_REPLY_CHAIN;
  if (unsupportedGraphqlCapabilities.has(capability)) {
    apiLog.warn('nagg.graphql.capability_fallback', {
      capability,
      operationName: graphqlOperationName(query),
      fallbackOperationName: graphqlOperationName(fallbackQuery),
      reason: 'cached_unsupported_capability',
    });
    return postGraphqlThread<T>(fallbackQuery, fallbackVariables, refresh, controls);
  }
  try {
    return await postGraphqlThread<T>(query, variables, refresh, controls);
  } catch (error) {
    if (!isAuthorReplyCapabilityError(error)) throw error;
    unsupportedGraphqlCapabilities.add(capability);
    apiLog.warn('nagg.graphql.capability_fallback', {
      capability,
      operationName: graphqlOperationName(query),
      fallbackOperationName: graphqlOperationName(fallbackQuery),
      reason: redactError(error),
    });
    return postGraphqlThread<T>(fallbackQuery, fallbackVariables, refresh, controls);
  }
}

function isAuthorReplyCapabilityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('authoredReplyChain') ||
    message.includes('AuthoredReplyChainInput') ||
    message.includes('PubkeySourceInput')
  );
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

function forYouInputFromSpec({
  parsed,
  viewerPubkey,
  limit,
  offset,
}: {
  parsed: Record<string, unknown> | null;
  viewerPubkey?: string;
  limit: number;
  offset?: number;
}): RankedEventsInput {
  const hours = feedWindowHours(parsed);
  const since = Math.floor(Date.now() / 1000) - hours * 60 * 60;
  return forYouRankedEventsInput({
    viewerPubkey,
    since,
    limit,
    offset,
  }) as RankedEventsInput;
}

function recentInputFromSpec({
  parsed,
  limit,
  offset,
}: {
  parsed: Record<string, unknown> | null;
  limit: number;
  offset?: number;
}): EventQueryInput {
  const hours = feedWindowHours(parsed);
  return recentNotesEventsInput({
    since: Math.floor(Date.now() / 1000) - hours * 60 * 60,
    limit,
    offset,
  }) as EventQueryInput;
}

function isForYouSpec(parsed: Record<string, unknown> | null): boolean {
  return parsed?.id === 'for-you' && parsed.kind === 'notes';
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

function threadRankCandidateLimit(limit: number, offset: number): number {
  return Math.max(100, offset + limit + RELEVANT_AUTHOR_REPLY_LIMIT + 1);
}

function childAuthorReplyNodes(node: GraphqlEventNode | undefined): GraphqlEventNode[] {
  return node?.childAuthorReplies?.nodes ?? [];
}

function childFollowedReplyNodes(node: GraphqlEventNode | undefined): GraphqlEventNode[] {
  return node?.childFollowedReply?.nodes ?? [];
}

function replyGraphEventFromNode(node: GraphqlEventNode | null | undefined) {
  const event = normalizeGraphqlEvent(node);
  if (!event) return undefined;
  return {
    id: event.id,
    pubkey: event.pubkey,
    tags: event.tags,
    createdAt: event.created_at,
  };
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
  const merged = mergeNaggRelevantReplyNodes({
    sourceNode,
    authorNodes,
    followedNodes,
    rankedNodes,
    allNodes,
    offset,
    limit,
    toEvent: replyGraphEventFromNode,
    childAuthorNodesFor: childAuthorReplyNodes,
    childFollowedNodesFor: childFollowedReplyNodes,
  });
  const pageEnd = limit == null ? merged.nodes.length : offset + limit;
  return {
    nodes: merged.nodes,
    pageNodes: merged.pageNodes,
    pageEventIds: merged.pageNodes
      .map((node) => normalizeGraphqlEvent(node)?.id)
      .filter((id): id is string => !!id),
    hasMore: merged.nodes.length > pageEnd,
  };
}

function threadReplyRankInput(
  sort: ThreadReplySort,
  viewerPubkey?: string
): ReferenceRankInput | null {
  return buildThreadReplyRankInput(sort, { viewerPubkey }) as ReferenceRankInput | null;
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
  const hours = feedWindowHours(parsed);
  const since = Math.floor(Date.now() / 1000) - hours * 60 * 60;
  return followingPopularRankedEventsInput({
    viewerPubkey,
    since,
    limit,
    offset,
  }) as RankedEventsInput;
}

function feedWindowHours(parsed: Record<string, unknown> | null): number {
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

type FeedPreferenceFilters = {
  ignoredPubkeys: string[];
  ignoredEventIds: string[];
};

function currentFeedPreferenceFilters(): FeedPreferenceFilters {
  const ignoreState = useFeedIgnoreStore.getState();
  return {
    ignoredPubkeys: ignoreState.ignoredPubkeys,
    ignoredEventIds: ignoreState.ignoredEventIds,
  };
}

function withPreferenceEventFilters(
  input: EventQueryInput,
  filters: FeedPreferenceFilters
): EventQueryInput {
  return withEventExclusions(input, {
    excludeIds: filters.ignoredEventIds,
    excludePubkeys: filters.ignoredPubkeys,
  });
}

function withPreferenceRankedFilters(
  input: RankedEventsInput,
  filters: FeedPreferenceFilters
): RankedEventsInput {
  return withRankedTargetExclusions(input, {
    excludeIds: filters.ignoredEventIds,
    excludePubkeys: filters.ignoredPubkeys,
  });
}

function feedQueryOptionsFromPreferences(filters: FeedPreferenceFilters): FeedQueryOptions {
  const ignoredPubkeys = new Set(filters.ignoredPubkeys.map((pubkey) => pubkey.toLowerCase()));
  const ignoredEventIds = new Set(filters.ignoredEventIds.map((id) => id.toLowerCase()));
  if (ignoredPubkeys.size === 0 && ignoredEventIds.size === 0) return {};

  const includeEvent = (event: FeedEvent | undefined) => {
    if (!event) return true;
    return (
      !ignoredPubkeys.has(event.pubkey.toLowerCase()) &&
      !ignoredEventIds.has(event.id.toLowerCase())
    );
  };

  return {
    includeNote: (event, rootEvent) => includeEvent(event) && includeEvent(rootEvent),
    includeRepost: (event, originalEvent, rootEvent) =>
      includeEvent(event) && includeEvent(originalEvent) && includeEvent(rootEvent),
  };
}

type NaggFeedPageOf = NaggFeedPage<FeedEvent, ProfileInfo>;

/**
 * The `events`-feed distiller (`graphqlToData`): distils the GraphQL `events`
 * connection into the canonical {@link NaggFeedPage}. Offset/until pagination is
 * the page's min `created_at` (set by `graphqlNodesToNaggPage`).
 */
// Logs the GraphQL distiller's node→item conversion. A large drop (many nodes
// in, few/zero items out) means the distiller is discarding the response — a key
// EMPTY-feed signal, distinct from "no nodes returned" or "schema rejected".
function logDistill(distiller: string, nodesIn: number, itemsOut: number): void {
  feedLog.info('feed.nagg.distill', {
    distiller,
    nodesIn,
    itemsOut,
    dropped: nodesIn - itemsOut,
  });
}

function eventsFeedToPage(data: unknown): NaggFeedPageOf {
  const feed = data as GraphqlFeedData;
  const nodes = feed.events?.nodes ?? [];
  const page = graphqlNodesToNaggPage(nodes) as NaggFeedPageOf;
  logDistill('events', nodes.length, page.items.length);
  return page;
}

/**
 * The ranked-feed distiller (`graphqlToData`): distils `rankedEvents` (or the
 * timeout-fallback `events`) into a {@link NaggFeedPage}. Ranked results paginate
 * by offset, so when the response is ranked we stamp the ranked sentinel
 * (`paginationUntil: 1`, `paginationOffset` = node count) the way the legacy
 * `mapRankedGraphqlFeed` did; the events fallback keeps min-`created_at` paging.
 */
function rankedFeedToPage(data: unknown): NaggFeedPageOf {
  const feed = data as GraphqlFeedData;
  if (feed.rankedEvents) {
    const nodes = feed.rankedEvents.nodes ?? [];
    const page = graphqlNodesToNaggPage(nodes) as NaggFeedPageOf;
    logDistill('ranked', nodes.length, page.items.length);
    return {
      ...page,
      paginationUntil: nodes.length > 0 ? 1 : 0,
      paginationOffset: nodes.length,
    };
  }
  const nodes = feed.events?.nodes ?? [];
  const page = graphqlNodesToNaggPage(nodes) as NaggFeedPageOf;
  logDistill('ranked-events-fallback', nodes.length, page.items.length);
  return page;
}

/**
 * The following-replies distiller (`graphqlToData`): resolves each reply's parent
 * context from the rich reference selections before distilling, so reply rows
 * render with their root/parent attached.
 */
function followingRepliesToPage(data: unknown): NaggFeedPageOf {
  const feed = data as GraphqlFeedData;
  const nodes = feed.events?.nodes ?? [];
  const page = graphqlNodesToNaggPage(nodes, {
    parentForNode: (node) =>
      node.rootContext?.nodes?.[0] ??
      node.parentReplyRefs?.nodes?.[0] ??
      node.parentRootRefs?.nodes?.[0] ??
      node.eventRefs?.nodes?.[0],
  }) as NaggFeedPageOf;
  logDistill('following-replies', nodes.length, page.items.length);
  return page;
}

/**
 * The profile-enrichment distiller (`graphqlToData`): the profile query returns
 * raw kind-0 metadata events, so distil them straight into the page's `profiles`
 * map (the rest of the page is empty — only the side map is consumed).
 */
function profileEventsToPage(data: unknown): NaggFeedPageOf {
  const feed = data as GraphqlFeedData;
  const profiles: NaggFeedPageOf['profiles'] = {};
  for (const node of feed.events?.nodes ?? []) {
    const profile = profileFromMetadataEvent(node);
    if (profile) profiles[node.pubkey] = profile;
  }
  return {
    items: [],
    metrics: {},
    profiles,
    quoted: {},
    paginationUntil: 0,
    paginationOffset: 0,
  };
}

/**
 * Map a {@link NaggFeedPage} (from either transport) through the shared mapper.
 * Pagination fields ride on the page itself, so ranked and events feeds paginate
 * exactly as they did before — there is no transport-specific post-processing.
 */
function mapNaggFeedPageResult(
  page: NaggFeedPageOf,
  options: FeedQueryOptions = {}
): FeedParseResult {
  return mapNaggFeedPage(page, options);
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

function compareNotificationsNewestFirst(
  left: FeedNotificationsResult['notifications'][number],
  right: FeedNotificationsResult['notifications'][number]
): number {
  return (
    right.event.created_at - left.event.created_at || right.event.id.localeCompare(left.event.id)
  );
}

function notificationTargetFromGraphqlNode(
  node: GraphqlEventNode | null | undefined,
  reason: string
): { targetEvent?: FeedEvent; targetEventId?: string } {
  if (!node) return {};
  const event = normalizeGraphqlEvent(node);
  const ownId = event?.id;
  const eventRefs = node.eventRefs?.nodes ?? [];
  const quoteRefs = node.quotedContent?.nodes ?? [];
  const rootRefs = node.rootContext?.nodes ?? [];
  const refById = new Map<string, GraphqlEventNode>();

  for (const ref of [...eventRefs, ...quoteRefs, ...rootRefs]) {
    const refEvent = normalizeGraphqlEvent(ref);
    if (!refEvent || refEvent.id === ownId) continue;
    refById.set(refEvent.id.toLowerCase(), ref);
  }

  const eventForId = (id: string | undefined): FeedEvent | undefined => {
    if (!id) return undefined;
    return normalizeGraphqlEvent(refById.get(id.toLowerCase()));
  };
  const firstEvent = (refs: readonly GraphqlEventNode[]): FeedEvent | undefined => {
    for (const ref of refs) {
      const refEvent = normalizeGraphqlEvent(ref);
      if (refEvent && refEvent.id !== ownId) return refEvent;
    }
    return undefined;
  };
  const firstTagId = (key: string, markers?: readonly string[]): string | undefined => {
    for (const tag of node.tags ?? []) {
      if (tag[0] !== key || typeof tag[1] !== 'string' || tag[1].length !== 64) continue;
      if (markers && !markers.includes(tag[3] ?? '')) continue;
      return tag[1];
    }
    return undefined;
  };
  const directReplyParentId = (): string | undefined => {
    const eTags = (node.tags ?? []).filter(
      (tag) => tag[0] === 'e' && typeof tag[1] === 'string' && tag[1].length === 64
    );
    const replyMarker = eTags.find((tag) => (tag[3] ?? '').toLowerCase() === 'reply');
    if (replyMarker?.[1]) return replyMarker[1];
    const lastUnmarked = [...eTags].reverse().find((tag) => !tag[3]);
    if (lastUnmarked?.[1]) return lastUnmarked[1];
    const rootMarker = eTags.find((tag) => (tag[3] ?? '').toLowerCase() === 'root');
    return rootMarker?.[1];
  };
  const withId = (targetEvent?: FeedEvent, targetEventId?: string) => {
    const id = targetEvent?.id ?? targetEventId;
    if (!id) return {};
    return targetEvent ? { targetEvent, targetEventId: id } : { targetEventId: id };
  };

  switch (reason) {
    case 'quote': {
      const qId = firstTagId('q');
      const mentionId = firstTagId('e', ['mention']);
      return withId(
        eventForId(qId) ?? firstEvent(quoteRefs) ?? eventForId(mentionId) ?? firstEvent(eventRefs),
        qId ?? mentionId
      );
    }
    case 'reply': {
      const parentId = directReplyParentId();
      return withId(
        eventForId(parentId) ?? firstEvent(eventRefs) ?? firstEvent(rootRefs),
        parentId
      );
    }
    case 'reaction':
    case 'repost':
    case 'zap': {
      const targetId = firstTagId('e');
      return withId(eventForId(targetId) ?? firstEvent(eventRefs), targetId);
    }
    default:
      return {};
  }
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

/**
 * The notifications distiller (`graphqlToData`): distils the GraphQL
 * `notifications` connection into the canonical {@link NaggNotificationsPage}.
 * Each node carries its `{ event, reason, actorVertexScore }` plus the resolved
 * `targetEvent`/`targetEventId` (the schema passes these through), and the feed
 * hydration (`metrics`/`profiles`/`quoted`) rides alongside as page side maps —
 * exactly the shape nagg's REST `/nostr/notifications` route emits.
 */
function notificationsToPage(data: unknown): NaggNotificationsPage {
  const feed = data as GraphqlNotificationsData;
  const sourceNodes = feed.notifications?.nodes ?? [];
  const eventNodes = sourceNodes
    .map((node) => node.event)
    .filter((event): event is GraphqlEventNode => !!event);
  const hydration = collectHydrationFromGraphqlNodes(eventNodes);
  const nodes: NaggNotificationsPage['notifications']['nodes'] = [];
  for (const node of sourceNodes) {
    const event = normalizeGraphqlEvent(node.event);
    if (!event) continue;
    const reason = node.reason || 'mention';
    const target = notificationTargetFromGraphqlNode(node.event, reason);
    nodes.push({
      event,
      reason,
      actorVertexScore:
        typeof node.actorVertexScore === 'number' && Number.isFinite(node.actorVertexScore)
          ? node.actorVertexScore
          : 0,
      ...target,
    });
  }
  logDistill('notifications', sourceNodes.length, nodes.length);
  return {
    notifications: {
      nodes,
      pageInfo: {
        endCursor: feed.notifications?.pageInfo?.endCursor ?? undefined,
        hasNextPage: feed.notifications?.pageInfo?.hasNextPage ?? false,
      },
    },
    metrics: Object.fromEntries(hydration.metrics),
    profiles: Object.fromEntries(hydration.profiles) as NaggNotificationsPage['profiles'],
    quoted: Object.fromEntries(hydration.quotedEvents) as NaggNotificationsPage['quoted'],
  };
}

/**
 * Build a {@link FeedNotificationsResult} from the parsed canonical
 * {@link NaggNotificationsPage}, identically for both transports: order notifs
 * newest-first, derive the next-page `until` cursor, and lift the hydration side
 * maps into the result Maps.
 */
function notificationsResultFromPage(page: NaggNotificationsPage): FeedNotificationsResult {
  const notifications = page.notifications.nodes
    .map((node) => {
      const enriched = node as NaggNotificationsPage['notifications']['nodes'][number] & {
        targetEvent?: FeedEvent;
        targetEventId?: string;
      };
      return {
        event: node.event as FeedEvent,
        ...(enriched.targetEvent ? { targetEvent: enriched.targetEvent } : {}),
        ...(enriched.targetEventId ? { targetEventId: enriched.targetEventId } : {}),
        reason: node.reason,
        actorVertexScore: node.actorVertexScore,
      };
    })
    .sort(compareNotificationsNewestFirst);
  return {
    notifications,
    metricsMap: new Map(Object.entries(page.metrics)) as Map<string, NoteMetrics>,
    profilesMap: new Map(Object.entries(page.profiles)) as Map<string, ProfileInfo>,
    quotedEventsMap: new Map(Object.entries(page.quoted)) as Map<string, FeedEvent>,
    paginationUntil:
      notifications.length > 0
        ? Math.min(...notifications.map((notification) => notification.event.created_at))
        : 0,
  };
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
      const preferenceFilters = currentFeedPreferenceFilters();
      const feedOptions = feedQueryOptionsFromPreferences(preferenceFilters);
      if (isForYouSpec(parsedSpec)) {
        const input = withPreferenceRankedFilters(
          forYouInputFromSpec({
            parsed: parsedSpec,
            viewerPubkey: userPubkey,
            limit,
            offset,
          }),
          preferenceFilters
        );
        const timeoutFallbackInput = withPreferenceEventFilters(
          recentInputFromSpec({ parsed: parsedSpec, limit, offset }),
          preferenceFilters
        );
        const viewerVariables = {
          input,
          ...(userPubkey ? { viewerPubkey: userPubkey } : {}),
        };
        const variables = {
          ...viewerVariables,
          authorChain: authoredReplyChainInput(),
        };
        const transport = feedTransport();
        const rankedControls = {
          dataSchema: NaggFeedPageSchema,
          graphqlToData: rankedFeedToPage,
          signal,
          timeoutMs,
        };
        const page = userPubkey
          ? await postGraphqlWithAuthorReplyAndTimeoutFallback(
              {
                query: RANKED_FEED_WITH_VIEWER_QUERY,
                variables,
                appView: rankedFeedAppView(input),
                transport,
              },
              { query: RANKED_FEED_WITH_VIEWER_LEGACY_QUERY, variables: viewerVariables },
              { query: FEED_QUERY, variables: { input: timeoutFallbackInput } },
              refresh,
              rankedControls
            )
          : await runNaggQuery(RANKED_FEED_QUERY, { input }, refresh, {
              ...rankedControls,
              appView: rankedFeedAppView(input),
              transport,
            });
        return logResult('for-you', mapNaggFeedPageResult(page as NaggFeedPageOf, feedOptions));
      }
      if (isFollowingRepliesSpec(parsedSpec)) {
        if (!userPubkey) return logResult('following-replies-no-viewer', emptyFeedParseResult());
        const input = withPreferenceEventFilters(
          followingRepliesEventsInput({
            viewerPubkey: userPubkey,
            limit,
            until,
            offset,
          }) as EventQueryInput,
          preferenceFilters
        );
        const page = await fetchNaggFeedPage(FOLLOWING_REPLIES_QUERY, { input }, refresh, {
          graphqlToData: followingRepliesToPage,
          appView: followsFeedAppView({ pubkeys: [userPubkey], until, limit, offset }),
          transport: feedTransport(),
          signal,
          timeoutMs,
        });
        return logResult('following-replies', mapNaggFeedPageResult(page, feedOptions));
      }
      if (isFollowingPopularSpec(parsedSpec)) {
        if (!userPubkey) return logResult('following-popular-no-viewer', emptyFeedParseResult());
        const input = withPreferenceRankedFilters(
          followingPopularInput({
            viewerPubkey: userPubkey,
            parsed: parsedSpec,
            limit,
            offset,
          }),
          preferenceFilters
        );
        const timeoutFallbackInput = withPreferenceEventFilters(
          followingRecentEventsInput({
            viewerPubkey: userPubkey,
            limit,
            offset,
          }) as EventQueryInput,
          preferenceFilters
        );
        const viewerVariables = {
          input,
          viewerPubkey: userPubkey,
        };
        const variables = {
          ...viewerVariables,
          authorChain: authoredReplyChainInput(),
        };
        const page = await postGraphqlWithAuthorReplyAndTimeoutFallback(
          {
            query: FOLLOWING_POPULAR_WITH_VIEWER_QUERY,
            variables,
            appView: rankedFeedAppView(input),
            transport: feedTransport(),
          },
          { query: FOLLOWING_POPULAR_WITH_VIEWER_LEGACY_QUERY, variables: viewerVariables },
          { query: FEED_QUERY, variables: { input: timeoutFallbackInput } },
          refresh,
          {
            dataSchema: NaggFeedPageSchema,
            graphqlToData: rankedFeedToPage,
            signal,
            timeoutMs,
          }
        );
        return logResult(
          'following-popular',
          mapNaggFeedPageResult(page as NaggFeedPageOf, feedOptions)
        );
      }
      if (isFollowingRecentSpec(parsedSpec)) {
        if (!userPubkey) return logResult('following-recent-no-viewer', emptyFeedParseResult());
        const input = withPreferenceEventFilters(
          followingRecentEventsInput({
            viewerPubkey: userPubkey,
            limit,
            until,
            offset,
          }) as EventQueryInput,
          preferenceFilters
        );
        const page = await fetchNaggFeedPage(FEED_QUERY, { input }, refresh, {
          graphqlToData: eventsFeedToPage,
          appView: followsFeedAppView({ pubkeys: [userPubkey], until, limit, offset }),
          transport: feedTransport(),
          signal,
          timeoutMs,
        });
        return logResult('following-recent', mapNaggFeedPageResult(page, feedOptions));
      }
      const input = withPreferenceEventFilters(
        feedInputFromSpec({ spec: hydratedSpec, limit, until, offset }),
        preferenceFilters
      );
      const genericPubkeys = pubkeysFromSpec(parsedSpec);
      const page = await fetchNaggFeedPage(FEED_QUERY, { input }, refresh, {
        graphqlToData: eventsFeedToPage,
        appView: followsFeedAppView({ pubkeys: genericPubkeys, until, limit, offset }),
        transport: feedTransport(),
        signal,
        timeoutMs,
      });
      return logResult('generic', mapNaggFeedPageResult(page, feedOptions));
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
      const page = await fetchNaggFeedPage(
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
        {
          graphqlToData: eventsFeedToPage,
          appView: userFeedAppView({ pubkey, until, limit, offset }),
          transport: feedTransport(),
          signal,
          timeoutMs,
        }
      );
      return mapNaggFeedPage(page, {
        includeNote: (event) => event.pubkey === pubkey && isRootNote(event),
        includeRepost: (event) => event.pubkey === pubkey,
        extraProfile: authorName
          ? { pubkey, profile: { name: authorName, picture: authorPicture } }
          : undefined,
      });
    },

    async getPostsByPubkeys({
      pubkeys,
      limit = 30,
      until,
      offset,
      refresh,
      signal,
      timeoutMs,
    }: PostsByPubkeysRequest) {
      if (pubkeys.length === 0) {
        return mapNaggFeedPage(graphqlNodesToNaggPage([]) as NaggFeedPageOf, {
          includeNote: () => false,
          includeRepost: () => false,
        });
      }
      const pubkeySet = new Set(pubkeys);
      const page = await fetchNaggFeedPage(
        FEED_QUERY,
        {
          input: {
            pubkeys,
            kinds: [1, 6, 16],
            limit,
            ...(until && { until }),
            ...(offset && { offset }),
          },
        },
        refresh,
        {
          graphqlToData: eventsFeedToPage,
          appView: followsFeedAppView({ pubkeys, until, limit, offset }),
          transport: feedTransport(),
          signal,
          timeoutMs,
        }
      );
      return mapNaggFeedPage(page, {
        includeNote: (event) => pubkeySet.has(event.pubkey) && isRootNote(event),
        includeRepost: (event) => pubkeySet.has(event.pubkey),
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
          runNaggQuery(
            ENRICH_EVENTS_QUERY,
            { input: { ids: missingQuotedIds, limit: missingQuotedIds.length } },
            refresh,
            { dataSchema: NaggFeedPageSchema, graphqlToData: eventsFeedToPage, signal, timeoutMs }
          ).then((page) => ({
            metrics: new Map(Object.entries(page.metrics)) as Map<string, NoteMetrics>,
            profiles: new Map(Object.entries(page.profiles)) as Map<string, ProfileInfo>,
            quotedEvents: new Map(Object.entries(page.quoted)) as Map<string, FeedEvent>,
          }))
        );
      }

      if (missingProfilePubkeys.length > 0) {
        tasks.push(
          runNaggQuery(
            PROFILE_EVENTS_QUERY,
            {
              input: {
                pubkeys: missingProfilePubkeys,
                kinds: [0],
                limit: missingProfilePubkeys.length,
              },
            },
            refresh,
            {
              dataSchema: NaggFeedPageSchema,
              graphqlToData: profileEventsToPage,
              signal,
              timeoutMs,
            }
          ).then((page) => ({
            profiles: new Map(Object.entries(page.profiles)) as Map<string, ProfileInfo>,
          }))
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

    async getNotifications({
      viewerPubkey,
      tab = 'ALL',
      policy = 'STRICT',
      replyScope = 'THREAD',
      since,
      until,
      limit = 50,
      refresh,
      signal,
      timeoutMs,
    }: FeedNotificationsRequest): Promise<FeedNotificationsResult> {
      const input = notificationsInput({
        viewer: viewerPubkey,
        tab,
        policy,
        replyScope,
        since,
        until,
        limit,
      });
      const page = await runNaggQuery(NOTIFICATIONS_QUERY, { input }, refresh, {
        dataSchema: NaggNotificationsPageSchema,
        graphqlToData: notificationsToPage,
        appView: notificationsAppView({
          viewer: viewerPubkey,
          tab,
          policy,
          replyScope,
          since,
          until,
          limit,
        }),
        transport: backendConfig.nostrNotificationsAppView ? 'appview' : 'graphql',
        signal,
        timeoutMs,
      });
      const result = notificationsResultFromPage(page);
      feedLog.info('feed.notifications.fetch.done', {
        transport: backendConfig.nostrNotificationsAppView ? 'appview' : 'graphql',
        tab,
        policy,
        replyScope,
        pageNodes: page.notifications.nodes.length,
        results: result.notifications.length,
        metrics: result.metricsMap.size,
        profiles: result.profilesMap.size,
        paginationUntil: result.paginationUntil,
      });
      return result;
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
            authorChain: authoredReplyChainInput(),
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
      // Thread is the documented exception to "prefer app-view": it stays on the
      // GraphQL relevance-ranked path because nagg's REST `/nostr/thread` cannot
      // reproduce the viewer-specific ranking (authoredReplyChain +
      // rankedReferencedBy over the follow graph). The reply order is derived
      // here by the relevant-reply merge, NOT by buildThreadStructure.
      const data = isRelevantSort
        ? await postGraphqlThreadWithAuthorReplyFallback<GraphqlThreadData>(
            query,
            variables,
            THREAD_RANKED_QUERY,
            fallbackVariables,
            false,
            { signal, timeoutMs }
          )
        : await postGraphqlThread<GraphqlThreadData>(query, variables, false, {
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
