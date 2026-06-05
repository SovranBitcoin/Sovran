export type ReplyGraphEvent = {
  id: string;
  pubkey: string;
  tags: string[][];
  createdAt: string | number | Date;
};

export type ReplyGraphNode<TNode> = {
  node: TNode;
  event: ReplyGraphEvent;
};

export type ReplyGraphMapper<TNode> = (node: TNode | null | undefined) => ReplyGraphEvent | undefined;
export type ReplyGraphChildrenMapper<TNode> = (node: TNode) => readonly TNode[];

export function directReplyParentId(event: ReplyGraphEvent): string | undefined {
  const eTags = event.tags.filter((tag) => tag[0] === 'e' && typeof tag[1] === 'string');
  const replyMarker = eTags.find((tag) => tag[3] === 'reply');
  if (replyMarker?.[1]) return replyMarker[1];
  const rootMarker = eTags.find((tag) => tag[3] === 'root');
  if (rootMarker && eTags.length > 1) {
    return eTags[eTags.length - 1]?.[1];
  }
  return eTags[eTags.length - 1]?.[1];
}

export function selectAuthorThreadChain<TNode>(input: {
  sourceEvent?: ReplyGraphEvent;
  authorNodes: readonly TNode[];
  toEvent: ReplyGraphMapper<TNode>;
  childAuthorNodesFor?: ReplyGraphChildrenMapper<TNode>;
}): TNode[] {
  if (!input.sourceEvent) return [];
  const pairs = nodeEventPairs(
    collectNestedReplyNodes(input.authorNodes, input.childAuthorNodesFor, input.toEvent),
    input.toEvent
  ).filter(({ event }) => event.pubkey === input.sourceEvent?.pubkey);
  const childrenByParent = new Map<string, Array<ReplyGraphNode<TNode>>>();
  for (const pair of pairs) {
    const parentId = directReplyParentId(pair.event);
    if (!parentId) continue;
    const children = childrenByParent.get(parentId) ?? [];
    children.push(pair);
    childrenByParent.set(parentId, children);
  }
  const chain: TNode[] = [];
  const seen = new Set<string>([input.sourceEvent.id]);
  let parentId = input.sourceEvent.id;
  for (;;) {
    const child = bestChild(childrenByParent.get(parentId), seen);
    if (!child) break;
    chain.push(child.node);
    seen.add(child.event.id);
    parentId = child.event.id;
  }
  return chain;
}

export function selectFollowedTailReply<TNode>(input: {
  sourceEvent?: ReplyGraphEvent;
  authorChain: readonly TNode[];
  followedNodes: readonly TNode[];
  toEvent: ReplyGraphMapper<TNode>;
  childFollowedNodesFor?: ReplyGraphChildrenMapper<TNode>;
}): TNode | undefined {
  const tail = input.toEvent(input.authorChain[input.authorChain.length - 1]) ?? input.sourceEvent;
  if (!tail) return undefined;
  const nestedFollowedNodes = input.authorChain.flatMap((node) =>
    input.childFollowedNodesFor?.(node) ?? []
  );
  return nodeEventPairs([...input.followedNodes, ...nestedFollowedNodes], input.toEvent).find(
    ({ event }) => directReplyParentId(event) === tail.id
  )?.node;
}

export function mergeRelevantReplyNodes<TNode>(input: {
  sourceNode?: TNode | null;
  sourceEvent?: ReplyGraphEvent;
  authorNodes?: readonly TNode[];
  followedNodes?: readonly TNode[];
  rankedNodes?: readonly TNode[];
  allNodes?: readonly TNode[];
  offset?: number;
  limit?: number;
  toEvent: ReplyGraphMapper<TNode>;
  childAuthorNodesFor?: ReplyGraphChildrenMapper<TNode>;
  childFollowedNodesFor?: ReplyGraphChildrenMapper<TNode>;
}): { nodes: TNode[]; pageNodes: TNode[]; authorChainIds: string[] } {
  const sourceEvent = input.sourceEvent ?? input.toEvent(input.sourceNode);
  const merged: TNode[] = [];
  const seen = new Set<string>();
  const append = (node: TNode | undefined): void => {
    const event = input.toEvent(node);
    if (!event || seen.has(event.id) || event.id === sourceEvent?.id) return;
    seen.add(event.id);
    merged.push(node as TNode);
  };
  const authorChain = selectAuthorThreadChain({
    sourceEvent,
    authorNodes: input.authorNodes ?? [],
    toEvent: input.toEvent,
    childAuthorNodesFor: input.childAuthorNodesFor,
  });
  for (const node of authorChain) append(node);
  append(
    selectFollowedTailReply({
      sourceEvent,
      authorChain,
      followedNodes: input.followedNodes ?? [],
      toEvent: input.toEvent,
      childFollowedNodesFor: input.childFollowedNodesFor,
    })
  );
  for (const node of input.rankedNodes ?? []) append(node);
  for (const node of input.allNodes ?? []) append(node);
  const offset = Math.max(0, input.offset ?? 0);
  const limit = Math.max(0, input.limit ?? merged.length);
  return {
    nodes: merged,
    pageNodes: limit === 0 ? [] : merged.slice(offset, offset + limit),
    authorChainIds: authorChain
      .map((node) => input.toEvent(node)?.id)
      .filter((id): id is string => typeof id === 'string'),
  };
}

function nodeEventPairs<TNode>(
  nodes: readonly TNode[],
  toEvent: ReplyGraphMapper<TNode>
): Array<ReplyGraphNode<TNode>> {
  return nodes.flatMap((node) => {
    const event = toEvent(node);
    return event ? [{ node, event }] : [];
  });
}

function collectNestedReplyNodes<TNode>(
  roots: readonly TNode[],
  childNodesFor: ReplyGraphChildrenMapper<TNode> | undefined,
  toEvent: ReplyGraphMapper<TNode>
): TNode[] {
  if (!childNodesFor) return [...roots];
  const out: TNode[] = [];
  const seen = new Set<string>();
  const visit = (node: TNode | undefined): void => {
    if (!node) return;
    const key = toEvent(node)?.id ?? `node:${out.length}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(node);
    for (const child of childNodesFor(node)) visit(child);
  };
  for (const root of roots) visit(root);
  return out;
}

function bestChild<TNode>(
  children: Array<ReplyGraphNode<TNode>> | undefined,
  seen: Set<string>
): ReplyGraphNode<TNode> | undefined {
  return (children ?? [])
    .filter(({ event }) => !seen.has(event.id))
    .sort((a, b) => eventTime(a.event) - eventTime(b.event) || a.event.id.localeCompare(b.event.id))[0];
}

function eventTime(event: ReplyGraphEvent): number {
  if (event.createdAt instanceof Date) return event.createdAt.getTime();
  if (typeof event.createdAt === 'number') return event.createdAt * 1000;
  const parsed = Date.parse(event.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}
