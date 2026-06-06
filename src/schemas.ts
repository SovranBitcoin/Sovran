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

export const NaggNotificationSchema = z
  .object({
    event: NaggEventSchema,
    reason: z.string(),
    actorVertexScore: z.number(),
  })
  .passthrough();

export const NaggNotificationConnectionSchema = z.object({
  nodes: z.array(NaggNotificationSchema),
  pageInfo: z
    .object({
      endCursor: z.unknown().optional(),
      hasNextPage: z.boolean().optional(),
    })
    .optional(),
});

const NullableString = z.string().nullable().optional();

export const NaggProfileSearchResultSchema = z
  .object({
    pubkey: z.string().length(64),
    npub: z.string(),
    rank: z.number().nullable().optional(),
    score: z.number().nullable().optional(),
    searchRank: z.number().nullable().optional(),
    searchScore: z.number().nullable().optional(),
    profileRank: z.number().nullable().optional(),
    profileScore: z.number().nullable().optional(),
    followers: z.number().int().nonnegative().nullable().optional(),
    follows: z.number().int().nonnegative().nullable().optional(),
    createdAt: z.union([z.string(), z.number(), z.date()]).nullable().optional(),
    name: NullableString,
    displayName: NullableString,
    picture: NullableString,
    image: NullableString,
    banner: NullableString,
    about: NullableString,
    nip05: NullableString,
    nip05Valid: z.boolean().nullable().optional(),
    website: NullableString,
    lud16: NullableString,
    lud06: NullableString,
  })
  .passthrough();

export const NaggProfileSearchConnectionSchema = z.object({
  query: z.string(),
  limit: z.number().int().nonnegative(),
  sort: z.string(),
  source: z.string().nullable().optional(),
  fromCache: z.boolean(),
  nodes: z.array(NaggProfileSearchResultSchema),
  pageInfo: z
    .object({
      endCursor: z.unknown().optional(),
      hasNextPage: z.boolean().optional(),
    })
    .optional(),
});

export const NaggProfileSearchDataSchema = z.object({
  profileSearch: NaggProfileSearchConnectionSchema,
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

// DM envelope data (zero-knowledge — raw encrypted events for client decrypt).
export const NaggDmEnvelopesDataSchema = z.object({
  dmEnvelopes: NaggEventConnectionSchema,
});

export const NaggDmConversationDataSchema = z.object({
  dmConversation: NaggEventConnectionSchema,
});

// Follow-status rows.
export const NaggFollowStatusRowSchema = z.object({
  pubkey: z.string().length(64),
  following: z.boolean(),
  followsYou: z.boolean(),
  mutual: z.boolean(),
  relationship: z.enum(['following', 'follows_you', 'mutual', 'none']),
});

export const NaggFollowStatusDataSchema = z.object({
  followStatus: z.array(NaggFollowStatusRowSchema),
});

// Own-account profiles with follower/following counts.
export const NaggOwnProfileSchema = z
  .object({
    pubkey: z.string().length(64),
    name: z.string().nullish(),
    displayName: z.string().nullish(),
    picture: z.string().nullish(),
    about: z.string().nullish(),
    nip05: z.string().nullish(),
    lud16: z.string().nullish(),
    banner: z.string().nullish(),
    website: z.string().nullish(),
    followers: z.number().int(),
    follows: z.number().int(),
    createdAt: z.union([z.string(), z.number(), z.date()]).nullish(),
  })
  .passthrough();

export const NaggOwnProfilesDataSchema = z.object({
  ownProfiles: z.array(NaggOwnProfileSchema),
});

// Whitenoise group messages / invites (raw events for client decrypt).
export const NaggWhitenoiseEventsDataSchema = z.object({
  events: NaggEventConnectionSchema,
});

// Posts-by-pubkeys: recent uses `events`, popular uses `rankedEvents`.
export const NaggPostsRecentDataSchema = z.object({
  events: NaggEventConnectionSchema,
});

export const NaggPostsPopularDataSchema = z.object({
  rankedEvents: NaggEventConnectionSchema,
});

// Wallpaper catalog (kind 1063 files + kind 30078 album catalog).
export const NaggWallpaperCatalogDataSchema = z.object({
  files: NaggEventConnectionSchema,
  albums: NaggEventConnectionSchema,
});

export type NaggGraphqlEnvelope = z.infer<typeof NaggGraphqlEnvelopeSchema>;
export type NaggEvent = z.infer<typeof NaggEventSchema>;
export type NaggAggregateRow = z.infer<typeof NaggAggregateRowSchema>;
export type NaggEventConnection = z.infer<typeof NaggEventConnectionSchema>;
export type NaggNotification = z.infer<typeof NaggNotificationSchema>;
export type NaggNotificationConnection = z.infer<typeof NaggNotificationConnectionSchema>;
export type NaggProfileSearchResult = z.infer<typeof NaggProfileSearchResultSchema>;
export type NaggProfileSearchConnection = z.infer<typeof NaggProfileSearchConnectionSchema>;
export type NaggProfileSearchData = z.infer<typeof NaggProfileSearchDataSchema>;
export type NaggServiceInfo = z.infer<typeof NaggServiceInfoSchema>;
export type NaggDmEnvelopesData = z.infer<typeof NaggDmEnvelopesDataSchema>;
export type NaggDmConversationData = z.infer<typeof NaggDmConversationDataSchema>;
export type NaggFollowStatusRow = z.infer<typeof NaggFollowStatusRowSchema>;
export type NaggFollowStatusData = z.infer<typeof NaggFollowStatusDataSchema>;
export type NaggOwnProfile = z.infer<typeof NaggOwnProfileSchema>;
export type NaggOwnProfilesData = z.infer<typeof NaggOwnProfilesDataSchema>;
export type NaggWhitenoiseEventsData = z.infer<typeof NaggWhitenoiseEventsDataSchema>;
export type NaggPostsRecentData = z.infer<typeof NaggPostsRecentDataSchema>;
export type NaggPostsPopularData = z.infer<typeof NaggPostsPopularDataSchema>;
export type NaggWallpaperCatalogData = z.infer<typeof NaggWallpaperCatalogDataSchema>;
