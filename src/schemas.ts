import { z } from 'zod';

export const NaggGraphqlErrorSchema = z
  .object({
    message: z.string().optional(),
    path: z.array(z.unknown()).optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const NaggGraphqlEnvelopeSchema = z
  .object({
    data: z.unknown().optional(),
    errors: z.array(NaggGraphqlErrorSchema).optional(),
  })
  .passthrough();

export const NaggUnknownDataSchema = z.unknown();

export const NaggEventSchema = z
  .object({
    id: z.string().length(64),
    pubkey: z.string().length(64),
    kind: z.number().int(),
    createdAt: z.union([z.string(), z.number(), z.date()]),
    content: z.string(),
    tags: z.array(z.array(z.string())),
    sig: z.string().optional(),
    updatedAt: z.union([z.string(), z.number(), z.date()]).optional(),
  })
  .passthrough();

export const NaggAggregateRowSchema = z.object({
  dimensions: z.record(z.string(), z.string()),
  metrics: z.record(z.string(), z.number()),
});

export const NaggAggregationResultSchema = z.object({
  rows: z.array(NaggAggregateRowSchema),
});

export const NaggEventConnectionSchema = z.object({
  nodes: z.array(NaggEventSchema),
  pageInfo: z
    .object({
      endCursor: z.unknown().optional(),
      hasNextPage: z.boolean().optional(),
    })
    .optional(),
});

export const AppViewCapabilitySchema = z.object({
  version: z.string(),
  routes: z.array(z.string()),
});

export const NaggServiceInfoSchema = z.object({
  graphqlSchemaVersion: z.string(),
  appViewVersion: z.string(),
  capabilities: z.array(z.string()),
  appViews: z.array(AppViewCapabilitySchema),
});

export type NaggGraphqlEnvelope = z.infer<typeof NaggGraphqlEnvelopeSchema>;
export type NaggEvent = z.infer<typeof NaggEventSchema>;
export type NaggAggregateRow = z.infer<typeof NaggAggregateRowSchema>;
export type NaggEventConnection = z.infer<typeof NaggEventConnectionSchema>;
export type NaggServiceInfo = z.infer<typeof NaggServiceInfoSchema>;
