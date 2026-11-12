import type { EventQueryInput, MetricInput, ShuffleInput, WeightedRankTermInput } from './rank';
import { engagementRankTerms, recencyTerm, vertexAuthorScoreTerm, viewerFollowBoost } from './rank';

const VERTEX_SCORED_PUBKEY_FILTER = { source: 'vertex' } as const;

export type RankedEventsInput = {
  references: EventQueryInput;
  via: { key: string; value?: string; values?: string[] };
  target?: EventQueryInput;
  metric?: MetricInput;
  terms?: WeightedRankTermInput[];
  candidatePubkeyBoosts?: Array<ReturnType<typeof viewerFollowBoost>>;
  /**
   * The requesting account, carried on every ranked request so future
   * viewer-personalized ranking needs no client/schema change. Optional and
   * currently advisory server-side.
   */
  pubkey?: string;
  shuffle?: ShuffleInput;
  limit?: number;
  offset?: number;
};

export type FollowedPubkeySource = NonNullable<EventQueryInput['pubkeysFrom']>;

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

export function forYouRankedEventsInput(options: {
  viewerPubkey?: string;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
  shuffle?: ShuffleInput;
  excludeTags?: Array<{ key: string; values: string[] }>;
  maxContentLength?: number;
}): RankedEventsInput {
  return {
    references: {
      kinds: [7, 9735, 6, 16, 1, 1111],
      since: options.since,
      until: options.until,
      limit: 1000,
      tags: options.excludeTags,
      pubkeyScore: VERTEX_SCORED_PUBKEY_FILTER,
    },
    via: { key: 'e' },
    target: {
      kinds: [1, 1111],
      limit: options.limit ?? 30,
      offset: 0,
      ...(options.maxContentLength ? { maxContentLength: options.maxContentLength } : {}),
    },
    metric: { name: 'actors', op: 'COUNT_DISTINCT', distinctField: 'PUBKEY' },
    terms: [
      ...engagementRankTerms({ pubkeyScore: VERTEX_SCORED_PUBKEY_FILTER }),
      vertexAuthorScoreTerm(0.3),
      recencyTerm(1.1),
    ],
    candidatePubkeyBoosts: options.viewerPubkey ? [viewerFollowBoost(options.viewerPubkey, 5)] : undefined,
    ...(options.viewerPubkey ? { pubkey: options.viewerPubkey } : {}),
    shuffle: options.shuffle,
    limit: options.limit ?? 30,
    offset: options.offset ?? 0,
  };
}

export function followingPopularRankedEventsInput(options: {
  viewerPubkey: string;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
  shuffle?: ShuffleInput;
  maxContentLength?: number;
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
      ...(options.maxContentLength ? { maxContentLength: options.maxContentLength } : {}),
    },
    metric: { name: 'actors', op: 'COUNT_DISTINCT', distinctField: 'PUBKEY' },
    terms: [...engagementRankTerms(), vertexAuthorScoreTerm(0.25), recencyTerm(0.9)],
    pubkey: options.viewerPubkey,
    shuffle: options.shuffle,
    limit: options.limit ?? 30,
    offset: options.offset ?? 0,
  };
}
