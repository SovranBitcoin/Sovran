import { Result } from 'neverthrow';
import { mergeRelevantReplyNodes } from '../recipes/reply-graph';
import type { NaggFeedEvent, NaggFeedPage, NaggNoteMetrics, NaggProfileInfo } from './feed';
import { DEFAULT_NAGG_NOTE_METRICS, firstTagValue } from './feed';

export type NaggGraphqlConnection<T> = {
  nodes?: T[];
  pageInfo?: { endCursor?: string | null; hasNextPage?: boolean };
};

export type NaggGraphqlEventNode = {
  id: string;
  pubkey: string;
  kind: number;
  createdAt: string | number | Date;
  content: string;
  tags: string[][];
  authorMetadata?: NaggGraphqlEventNode[];
  eventRefs?: NaggGraphqlConnection<NaggGraphqlEventNode>;
  rootContext?: NaggGraphqlConnection<NaggGraphqlEventNode>;
  parentReplyRefs?: NaggGraphqlConnection<NaggGraphqlEventNode>;
  parentRootRefs?: NaggGraphqlConnection<NaggGraphqlEventNode>;
  parentRefs?: NaggGraphqlConnection<NaggGraphqlEventNode>;
  quotedContent?: NaggGraphqlConnection<NaggGraphqlEventNode>;
  authorReplies?: NaggGraphqlConnection<NaggGraphqlEventNode>;
  followedReply?: NaggGraphqlConnection<NaggGraphqlEventNode>;
  childAuthorReplies?: NaggGraphqlConnection<NaggGraphqlEventNode>;
  childFollowedReply?: NaggGraphqlConnection<NaggGraphqlEventNode>;
  allReplies?: NaggGraphqlConnection<NaggGraphqlEventNode>;
  replies?: NaggGraphqlConnection<NaggGraphqlEventNode>;
  childReplies?: NaggGraphqlConnection<NaggGraphqlEventNode>;
  // Precomputed per-event engagement counts (the `noteStats` GraphQL field, read
  // from nagg's rollup count tables). Replaces the four live aggregateReferencedBy
  // selections the feed used to embed per node.
  noteStats?: NaggGraphqlNoteStats;
  [key: string]: unknown;
};

export type NaggGraphqlNoteStats = {
  likes?: number;
  reposts?: number;
  replies?: number;
  zapSats?: number;
  realLikes?: number;
  realReposts?: number;
  realReplies?: number;
  realZapSats?: number;
};

export type GraphqlNodesToNaggPageOptions<TNode extends NaggGraphqlEventNode> = {
  parentForNode?: (node: TNode) => TNode | undefined;
};

export function graphqlNodesToNaggPage<TNode extends NaggGraphqlEventNode>(
  nodes: TNode[],
  options: GraphqlNodesToNaggPageOptions<TNode> = {}
): NaggFeedPage<NaggFeedEvent, NaggProfileInfo> {
  const metrics: Record<string, NaggNoteMetrics> = {};
  const profiles: Record<string, NaggProfileInfo> = {};
  const quoted: Record<string, NaggFeedEvent> = {};
  const items: NaggFeedPage<NaggFeedEvent, NaggProfileInfo>['items'] = [];
  let paginationUntil = 0;

  const hydrate = (node: NaggGraphqlEventNode | undefined): void => {
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

    const eventRefs = (node.eventRefs?.nodes ?? []).map(normalizeGraphqlEvent).filter(isFeedEvent);
    const explicitParent = normalizeGraphqlEvent(options.parentForNode?.(node));
    const resolvedRoot = normalizeGraphqlEvent(node.rootContext?.nodes?.[0]);
    const rootEvent =
      explicitParent ??
      (resolvedRoot && resolvedRoot.id !== event.id ? resolvedRoot : undefined) ??
      eventRefs.find((ref) => ref.id !== event.id) ??
      undefined;

    hydrateConnection(node.eventRefs, hydrate);
    hydrateConnection(node.parentReplyRefs, hydrate);
    hydrateConnection(node.parentRootRefs, hydrate);
    hydrateConnection(node.rootContext, hydrate);

    const replyPreviewNodes = mergeRelevantReplyNodes({
      sourceNode: node,
      authorNodes: node.authorReplies?.nodes,
      followedNodes: node.followedReply?.nodes,
      toEvent: replyGraphEventFromNode,
      childAuthorNodesFor: childAuthorReplyNodes,
      childFollowedNodesFor: childFollowedReplyNodes,
    }).nodes;
    for (const replyNode of replyPreviewNodes) hydrate(replyNode);
    const replyPreviewEvents = replyPreviewNodes
      .map(normalizeGraphqlEvent)
      .filter((replyEvent): replyEvent is NaggFeedEvent => !!replyEvent && replyEvent.id !== event.id);

    if (event.kind === 6 || event.kind === 16) {
      const originalEvent = eventRefs[0] ?? undefined;
      const originalEventId = originalEvent?.id ?? firstTagValue(event, 'e') ?? '';
      if (!originalEventId) continue;
      items.push({
        type: 'repost',
        repostEvent: event,
        originalEvent,
        originalEventId,
        rootEvent,
        rootEventId: rootEvent?.id,
        reposters: [{ pubkey: event.pubkey, event }],
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
  };
}

export function normalizeGraphqlEvent(
  node: NaggGraphqlEventNode | null | undefined
): NaggFeedEvent | undefined {
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

export function profileFromMetadataEvent(
  node: NaggGraphqlEventNode | undefined
): NaggProfileInfo | undefined {
  if (!node || node.kind !== 0) return undefined;
  const parsed = parseJsonObject(node.content);
  if (!parsed) return undefined;
  const displayName = stringField(parsed.display_name) ?? stringField(parsed.displayName);
  const name = displayName ?? stringField(parsed.name) ?? '';
  const picture = stringField(parsed.picture) ?? stringField(parsed.image);
  return { name, ...(picture ? { picture } : {}) };
}

export function metricsFromGraphqlNode(node: NaggGraphqlEventNode): NaggNoteMetrics {
  const stats = node.noteStats;
  return {
    likeCount: finiteCount(stats?.likes),
    repostCount: finiteCount(stats?.reposts),
    replyCount: finiteCount(stats?.replies),
    satsZapped: finiteCount(stats?.zapSats),
  };
}

function finiteCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function replyGraphEventFromNode(node: NaggGraphqlEventNode | null | undefined) {
  const event = normalizeGraphqlEvent(node);
  if (!event) return undefined;
  return {
    id: event.id,
    pubkey: event.pubkey,
    tags: event.tags,
    createdAt: event.created_at,
  };
}

function childAuthorReplyNodes(node: NaggGraphqlEventNode | undefined): NaggGraphqlEventNode[] {
  return node?.childAuthorReplies?.nodes ?? [];
}

function childFollowedReplyNodes(node: NaggGraphqlEventNode | undefined): NaggGraphqlEventNode[] {
  return node?.childFollowedReply?.nodes ?? [];
}

function hydrateConnection(
  connection: NaggGraphqlConnection<NaggGraphqlEventNode> | undefined,
  hydrate: (node: NaggGraphqlEventNode | undefined) => void
): void {
  for (const node of connection?.nodes ?? []) hydrate(node);
}

function isFeedEvent(event: NaggFeedEvent | undefined): event is NaggFeedEvent {
  return !!event;
}

function createdAtSeconds(value: string | number | Date): number {
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  if (typeof value === 'number') {
    return value > 1_000_000_000_000 ? Math.floor(value / 1000) : value;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  return Result.fromThrowable(JSON.parse, () => undefined)(value).match(
    (parsed) =>
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined,
    () => undefined
  );
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export { DEFAULT_NAGG_NOTE_METRICS };
