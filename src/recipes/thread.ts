import type { ReferenceRankInput, ShuffleInput } from './rank';
import {
  contributionQualityTerm,
  engagementRankTerms,
  recencyTerm,
  vertexAuthorScoreTerm,
  viewerFollowBoost,
} from './rank';

export type ThreadReplySort = 'relevant' | 'new' | 'likes' | 'zaps' | 'reposts';

export type AuthoredReplyChainInput = {
  events?: {
    kinds?: number[];
    limit?: number;
  };
  kinds?: number[];
  via?: {
    key: string;
    value?: string;
    values?: string[];
    marker?: string;
    markers?: string[];
    excludeMarkers?: string[];
    index?: number;
  };
  target?: 'EVENT_ID' | 'PUBKEY' | 'ADDRESS' | string;
  maxDepth?: number;
  maxBranchFanout?: number;
};

export function authoredReplyChainInput(
  options: { maxDepth?: number; maxBranchFanout?: number } = {}
): AuthoredReplyChainInput {
  return {
    kinds: [1, 1111],
    via: { key: 'e' },
    target: 'EVENT_ID',
    maxDepth: options.maxDepth ?? 8,
    maxBranchFanout: options.maxBranchFanout ?? 32,
  };
}

export function threadReplyRankInput(
  sort: ThreadReplySort,
  options: { viewerPubkey?: string; shuffle?: ShuffleInput } = {}
): ReferenceRankInput | null {
  if (sort === 'new') return null;
  const base: ReferenceRankInput = {
    references: { kinds: [7], limit: 500 },
    via: { key: 'e' },
    metric: { name: 'likes', op: 'COUNT_DISTINCT', distinctField: 'PUBKEY' },
    shuffle: options.shuffle,
  };
  if (sort === 'likes') return base;
  if (sort === 'zaps') {
    return {
      references: { kinds: [9735], limit: 500 },
      via: { key: 'e' },
      metric: { name: 'zapSats', op: 'SUM', derived: 'nip57.amount_sats' },
      shuffle: options.shuffle,
    };
  }
  if (sort === 'reposts') {
    return {
      references: { kinds: [6, 16], limit: 500 },
      via: { key: 'e' },
      metric: { name: 'reposts', op: 'COUNT_DISTINCT', distinctField: 'PUBKEY' },
      shuffle: options.shuffle,
    };
  }
  return {
    references: { kinds: [7], limit: 500 },
    via: { key: 'e' },
    metric: { name: 'likes', op: 'COUNT_DISTINCT', distinctField: 'PUBKEY' },
    terms: [
      contributionQualityTerm(3),
      ...engagementRankTerms(),
      vertexAuthorScoreTerm(0.25),
      recencyTerm(0.8),
    ],
    candidatePubkeyBoosts: options.viewerPubkey ? [viewerFollowBoost(options.viewerPubkey)] : undefined,
    shuffle: options.shuffle,
  };
}
