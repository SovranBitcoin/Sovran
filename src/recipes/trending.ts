import type { EventQueryInput, ShuffleInput } from './rank';
import { engagementRankTerms, recencyTerm, vertexAuthorScoreTerm, type ReferenceRankInput } from './rank';

export type TrendingWindow = 'H8' | 'H24' | 'D7';

export type TrendingInput = {
  window?: TrendingWindow;
  category?: string;
  limit?: number;
};

export function trendingInput(options: TrendingInput = {}): Required<Pick<TrendingInput, 'window' | 'limit'>> &
  Pick<TrendingInput, 'category'> {
  return {
    window: options.window ?? 'H24',
    ...(options.category ? { category: options.category } : {}),
    limit: options.limit ?? 10,
  };
}

export function trendingClusterFeedInput(options: {
  clusterId: string;
  limit?: number;
  offset?: number;
  shuffle?: ShuffleInput;
}): EventQueryInput {
  return {
    kinds: [1, 1111],
    tags: [
      {
        key: 'cluster',
        value: options.clusterId,
        dataset: 'DERIVED_TAGS',
      },
    ],
    limit: options.limit ?? 30,
    ...(options.offset ? { offset: options.offset } : {}),
    ...(options.shuffle ? { shuffle: options.shuffle } : {}),
  };
}

export function trendingClusterRankedEventsInput(options: {
  clusterId: string;
  limit?: number;
  offset?: number;
  shuffle?: ShuffleInput;
}): ReferenceRankInput & { target: EventQueryInput; limit: number; offset: number } {
  return {
    references: {
      kinds: [7, 9735, 6, 16, 1, 1111],
      limit: 1000,
    },
    via: { key: 'e' },
    target: trendingClusterFeedInput({
      clusterId: options.clusterId,
      limit: options.limit ?? 30,
      offset: options.offset,
    }),
    metric: { name: 'actors', op: 'COUNT_DISTINCT', distinctField: 'PUBKEY' },
    terms: [...engagementRankTerms(), vertexAuthorScoreTerm(0.25), recencyTerm(0.9)],
    shuffle: options.shuffle,
    limit: options.limit ?? 30,
    offset: options.offset ?? 0,
  };
}
