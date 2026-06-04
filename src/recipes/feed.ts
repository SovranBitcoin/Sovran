import type { EventQueryInput, ShuffleInput, WeightedRankTermInput } from './rank';
import { engagementRankTerms, recencyTerm, vertexAuthorScoreTerm, viewerFollowBoost } from './rank';

export type RankedEventsInput = {
  references: EventQueryInput;
  via: { key: string; value?: string; values?: string[] };
  target?: EventQueryInput;
  metric?: { name?: string; op?: string; distinctField?: string };
  terms?: WeightedRankTermInput[];
  candidatePubkeyBoosts?: Array<ReturnType<typeof viewerFollowBoost>>;
  shuffle?: ShuffleInput;
  limit?: number;
  offset?: number;
};

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
      pubkeysFrom: [
        {
          latestEventTags: {
            pubkey: options.viewerPubkey,
            kinds: [3],
            tag: { key: 'p' },
            limit: 1,
            maxValues: 2000,
          },
        },
      ],
      limit: options.limit ?? 30,
    },
    metric: { name: 'actors', op: 'COUNT_DISTINCT', distinctField: 'PUBKEY' },
    terms: [...engagementRankTerms(), vertexAuthorScoreTerm(0.25), recencyTerm(0.9)],
    shuffle: options.shuffle,
    limit: options.limit ?? 30,
    offset: options.offset ?? 0,
  };
}
