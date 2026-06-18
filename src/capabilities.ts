import { z } from 'zod';
import { okAsync, ResultAsync } from 'neverthrow';
import { NaggServiceInfoSchema, type NaggServiceInfo } from './schemas';
import type { NaggClient } from './transport';
import type { NaggError } from './errors';

export const NAGG_CAPABILITIES = {
  AUTHORED_REPLY_CHAIN: 'graphql.authoredReplyChain',
  EVENTS_SEARCH: 'graphql.events.search',
  EVENTS_SHUFFLE: 'graphql.events.shuffle',
  EVENTS_EXCLUDE_IDS_PUBKEYS: 'graphql.events.excludeIdsPubkeys',
  AGGREGATE_EVENTS_SHUFFLE: 'graphql.aggregateEvents.shuffle',
  RANK_PUBKEY_SCORE_TERMS: 'graphql.rank.pubkeyScoreTerms',
  RANK_PUBKEY_SCORE_FILTERS: 'graphql.rank.pubkeyScoreFilters',
  RANK_CANDIDATE_FIELD_TERMS: 'graphql.rank.candidateFieldTerms',
  RANK_DERIVED_METRIC_TERMS: 'graphql.rank.derivedMetricTerms',
  RANK_SHUFFLE: 'graphql.rank.shuffle',
  TAGS_DERIVED_DATASET: 'graphql.tags.derivedDataset',
  TAGS_EXCLUDE_VALUES: 'graphql.tags.excludeValues',
  NOTIFICATIONS: 'graphql.notifications',
  PROFILE_SEARCH: 'graphql.profileSearch',
} as const;

export type NaggCapability =
  | (typeof NAGG_CAPABILITIES)[keyof typeof NAGG_CAPABILITIES]
  | (string & {});

export const SERVICE_INFO_QUERY = `
query NaggServiceInfo {
  serviceInfo {
    graphqlSchemaVersion
    appViewVersion
    capabilities
    appViews { version routes }
  }
}
`;

const ServiceInfoDataSchema = z.object({
  serviceInfo: NaggServiceInfoSchema,
});

export interface NaggCapabilityCache {
  serviceInfo(): ResultAsync<NaggServiceInfo, NaggError>;
  supports(capability: NaggCapability): ResultAsync<boolean, NaggError>;
  clear(): void;
}

export function probeServiceInfo(client: NaggClient): ResultAsync<NaggServiceInfo, NaggError> {
  return client
    .query({
      query: SERVICE_INFO_QUERY,
      operationName: 'NaggServiceInfo',
      dataSchema: ServiceInfoDataSchema,
    })
    .map((data) => data.serviceInfo);
}

export function createNaggCapabilityCache(client: NaggClient): NaggCapabilityCache {
  let cached: NaggServiceInfo | undefined;
  let pending: ResultAsync<NaggServiceInfo, NaggError> | undefined;

  const serviceInfo = (): ResultAsync<NaggServiceInfo, NaggError> => {
    if (cached) return okAsync(cached);
    if (!pending) {
      pending = probeServiceInfo(client)
        .map((info) => {
          cached = info;
          return info;
        })
        .mapErr((error) => {
          pending = undefined;
          return error;
        });
    }
    return pending;
  };

  return {
    serviceInfo,
    supports: (capability) =>
      serviceInfo().map((info) => info.capabilities.includes(capability)),
    clear: () => {
      cached = undefined;
      pending = undefined;
    },
  };
}
