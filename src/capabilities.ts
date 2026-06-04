import { z } from 'zod';
import type { ResultAsync } from 'neverthrow';
import { NaggServiceInfoSchema } from './schemas';
import type { NaggClient } from './transport';
import type { NaggError } from './errors';

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

export function probeServiceInfo(client: NaggClient): ResultAsync<z.infer<typeof NaggServiceInfoSchema>, NaggError> {
  return client
    .query({
      query: SERVICE_INFO_QUERY,
      operationName: 'NaggServiceInfo',
      dataSchema: ServiceInfoDataSchema,
    })
    .map((data) => data.serviceInfo);
}
