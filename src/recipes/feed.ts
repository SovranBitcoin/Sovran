import type { EventQueryInput, MetricInput, ShuffleInput, WeightedRankTermInput } from './rank';
import { engagementRankTerms, recencyTerm, vertexAuthorScoreTerm, viewerFollowBoost } from './rank';

export type RankedEventsInput = {
  references: EventQueryInput;
  via: { key: string; value?: string; values?: string[] };
  target?: EventQueryInput;
  metric?: MetricInput;
  terms?: WeightedRankTermInput[];
  candidatePubkeyBoosts?: Array<ReturnType<typeof viewerFollowBoost>>;
  shuffle?: ShuffleInput;
  limit?: number;
  offset?: number;
};

export type FollowedPubkeySource = NonNullable<EventQueryInput['pubkeysFrom']>;

export type FeedExclusionFilters = {
  excludeIds?: readonly string[];
  excludePubkeys?: readonly string[];
};

function normalizedExclusionValues(values: readonly string[] | undefined): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0)
    )
  ).sort();
}

export function withEventExclusions<T extends EventQueryInput>(
  input: T,
  filters: FeedExclusionFilters
): T {
  const inputExcludeIds = input.excludeIds ?? [];
  const inputExcludePubkeys = input.excludePubkeys ?? [];
  const excludeIds = normalizedExclusionValues([...inputExcludeIds, ...(filters.excludeIds ?? [])]);
  const excludePubkeys = normalizedExclusionValues([
    ...inputExcludePubkeys,
    ...(filters.excludePubkeys ?? []),
  ]);
  if (excludeIds.length === 0 && excludePubkeys.length === 0) return input;
  return {
    ...input,
    ...(excludeIds.length > 0 ? { excludeIds } : {}),
    ...(excludePubkeys.length > 0 ? { excludePubkeys } : {}),
  } as T;
}

export function withRankedTargetExclusions<T extends RankedEventsInput>(
  input: T,
  filters: FeedExclusionFilters
): T {
  const baseTarget = input.target ?? {};
  const target = withEventExclusions(baseTarget, filters);
  if (target === baseTarget) return input;
  return {
    ...input,
    target,
  } as T;
}

export function shuffleInput(options: {
  seed: string;
  counter?: number;
  strength?: number;
}): ShuffleInput {
  return {
    seed: options.seed,
    ...(options.counter != null ? { counter: options.counter } : {}),
    ...(options.strength != null ? { strength: options.strength } : {}),
  };
}

export function followedPubkeySource(viewerPubkey: string): FollowedPubkeySource {
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

export function globalTrendingRankedEventsInput(options: {
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
  shuffle?: ShuffleInput;
}): RankedEventsInput {
  return {
    references: {
      kinds: [7],
      since: options.since,
      until: options.until,
    },
    via: { key: 'e' },
    target: { kinds: [1] },
    metric: { name: 'likers', op: 'COUNT_DISTINCT', distinctField: 'PUBKEY' },
    shuffle: options.shuffle,
    limit: options.limit ?? 30,
    ...(options.offset ? { offset: options.offset } : {}),
  };
}

export function forYouRankedEventsInput(options: {
  viewerPubkey?: string;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
  shuffle?: ShuffleInput;
  excludeTags?: Array<{ key: string; values: string[] }>;
}): RankedEventsInput {
  return {
    references: {
      kinds: [7, 9735, 6, 16, 1, 1111],
      since: options.since,
      until: options.until,
      limit: 1000,
      tags: options.excludeTags,
    },
    via: { key: 'e' },
    target: { kinds: [1, 1111], limit: options.limit ?? 30, offset: 0 },
    metric: { name: 'actors', op: 'COUNT_DISTINCT', distinctField: 'PUBKEY' },
    terms: [...engagementRankTerms(), vertexAuthorScoreTerm(0.3), recencyTerm(1.1)],
    candidatePubkeyBoosts: options.viewerPubkey ? [viewerFollowBoost(options.viewerPubkey, 5)] : undefined,
    shuffle: options.shuffle,
    limit: options.limit ?? 30,
    offset: options.offset ?? 0,
  };
}

export function recentNotesEventsInput(options: {
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
  shuffle?: ShuffleInput;
}): EventQueryInput {
  return {
    kinds: [1, 1111],
    since: options.since,
    until: options.until,
    limit: options.limit ?? 30,
    ...(options.offset ? { offset: options.offset } : {}),
    ...(options.shuffle ? { shuffle: options.shuffle } : {}),
  };
}

export function followingRepliesEventsInput(options: {
  viewerPubkey: string;
  limit?: number;
  until?: number;
  offset?: number;
  shuffle?: ShuffleInput;
}): EventQueryInput {
  return {
    kinds: [1, 1111],
    tags: [{ key: 'e' }],
    pubkeysFrom: followedPubkeySource(options.viewerPubkey),
    limit: options.limit ?? 30,
    ...(options.until ? { until: options.until } : {}),
    ...(options.offset ? { offset: options.offset } : {}),
    ...(options.shuffle ? { shuffle: options.shuffle } : {}),
  };
}

export function followingRecentEventsInput(options: {
  viewerPubkey: string;
  limit?: number;
  until?: number;
  offset?: number;
  shuffle?: ShuffleInput;
}): EventQueryInput {
  return {
    kinds: [1, 1111],
    pubkeysFrom: followedPubkeySource(options.viewerPubkey),
    limit: options.limit ?? 30,
    ...(options.until ? { until: options.until } : {}),
    ...(options.offset ? { offset: options.offset } : {}),
    ...(options.shuffle ? { shuffle: options.shuffle } : {}),
  };
}

export function followingPopularRankedEventsInput(options: {
  viewerPubkey: string;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
  shuffle?: ShuffleInput;
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
      kinds: [1, 1111],
      pubkeysFrom: followedPubkeySource(options.viewerPubkey),
      limit: options.limit ?? 30,
    },
    metric: { name: 'actors', op: 'COUNT_DISTINCT', distinctField: 'PUBKEY' },
    terms: [...engagementRankTerms(), vertexAuthorScoreTerm(0.25), recencyTerm(0.9)],
    shuffle: options.shuffle,
    limit: options.limit ?? 30,
    offset: options.offset ?? 0,
  };
}
