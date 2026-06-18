export type MetricInput = {
  name?: string;
  op?: 'COUNT' | 'COUNT_DISTINCT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
  field?: string;
  distinctField?: string;
  derived?: string;
};

export type TagFilterInput = {
  key: string;
  value?: string;
  values?: string[];
  excludeValues?: string[];
  dataset?: 'TAGS' | 'DERIVED_TAGS' | string;
};

export type EventQueryInput = {
  ids?: string[];
  pubkeys?: string[];
  excludeIds?: string[];
  excludePubkeys?: string[];
  kinds?: number[];
  tags?: TagFilterInput[];
  search?: string;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
  shuffle?: ShuffleInput;
  pubkeysFrom?: unknown[];
  pubkeyScore?: PubkeyScoreFilterInput;
};

export type PubkeyScoreFilterInput = {
  source?: string;
  minFollowers?: number;
};

export type WeightedRankTermInput = {
  references?: EventQueryInput;
  via?: TagFilterInput;
  metric?: MetricInput;
  pubkeyScore?: {
    source?: string;
    target?: 'AUTHOR' | string;
    minFollowers?: number;
    fallback?: number;
  };
  candidateField?: 'CREATED_AT' | string;
  derivedMetric?: string;
  weight?: number;
  transform?: 'IDENTITY' | 'LOG1P' | 'RECENCY_HALFLIFE' | string;
  halfLifeSeconds?: number;
};

export type CandidatePubkeyBoostInput = {
  pubkeys?: string[];
  pubkeysFrom?: unknown[];
  weight?: number;
};

export type ShuffleInput = {
  seed: string;
  counter?: number;
  strength?: number;
};

export type ReferenceRankInput = {
  references: EventQueryInput;
  via: TagFilterInput;
  metric?: MetricInput;
  weight?: number;
  transform?: string;
  terms?: WeightedRankTermInput[];
  candidatePubkeyBoosts?: CandidatePubkeyBoostInput[];
  shuffle?: ShuffleInput;
};

export type EngagementRankTermOptions = {
  pubkeyScore?: PubkeyScoreFilterInput;
};

function engagementReferences(
  input: EventQueryInput,
  options: EngagementRankTermOptions
): EventQueryInput {
  if (!options.pubkeyScore) return input;
  return { ...input, pubkeyScore: options.pubkeyScore };
}

export function engagementRankTerms(options: EngagementRankTermOptions = {}): WeightedRankTermInput[] {
  return [
    {
      references: engagementReferences({ kinds: [7], limit: 500 }, options),
      via: { key: 'e' },
      metric: { name: 'likes', op: 'COUNT_DISTINCT', distinctField: 'PUBKEY' },
      weight: 3,
      transform: 'LOG1P',
    },
    {
      references: engagementReferences({ kinds: [1, 1111], limit: 500 }, options),
      via: { key: 'e' },
      metric: { name: 'replies', op: 'COUNT' },
      weight: 2.5,
      transform: 'LOG1P',
    },
    {
      references: engagementReferences({ kinds: [6, 16], limit: 500 }, options),
      via: { key: 'e' },
      metric: { name: 'reposts', op: 'COUNT_DISTINCT', distinctField: 'PUBKEY' },
      weight: 2,
      transform: 'LOG1P',
    },
    {
      references: engagementReferences({ kinds: [9735], limit: 500 }, options),
      via: { key: 'e' },
      metric: { name: 'zapSats', op: 'SUM', derived: 'nip57.amount_sats' },
      weight: 1.5,
      transform: 'LOG1P',
    },
  ];
}

export function vertexAuthorScoreTerm(weight = 0.25): WeightedRankTermInput {
  return {
    pubkeyScore: { source: 'vertex', target: 'AUTHOR' },
    weight,
  };
}

export function recencyTerm(weight = 1.2, halfLifeSeconds = 86_400): WeightedRankTermInput {
  return {
    candidateField: 'CREATED_AT',
    transform: 'RECENCY_HALFLIFE',
    halfLifeSeconds,
    weight,
  };
}

export function contributionQualityTerm(weight = 3): WeightedRankTermInput {
  return {
    derivedMetric: 'contribution_quality',
    weight,
  };
}

export function viewerFollowBoost(viewerPubkey: string, weight = 6): CandidatePubkeyBoostInput {
  return {
    pubkeysFrom: [
      {
        latestEventTags: {
          pubkey: viewerPubkey,
          kinds: [3],
          tag: { key: 'p' },
          limit: 1,
          maxValues: 2000,
        },
      },
    ],
    weight,
  };
}
