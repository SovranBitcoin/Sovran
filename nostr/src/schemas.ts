import { z } from 'zod';

// Local mirror of the shared @sovranbitcoin/schemas OrderingManifest. Defined in
// nagg-ts's own zod (not imported as a value) so composing it into the feed/
// thread schemas keeps the inferred types portable — the symlinked shared
// package carries its own zod copy, and mixing the two breaks type emission.
export const NaggOrderingSchema = z.object({
  orderBy: z.enum(['rank', 'created_at', 'arrival']),
  elements: z.array(z.string()).max(5000),
});

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

// ---------------------------------------------------------------------------
// Canonical feed-page / thread / notifications shapes — ONE parser per view,
// both transports.
//
// nagg's REST app-view emits these shapes directly (a server-shaped
// `FeedResponse`/`ThreadResponse`/`NotificationsResponse`), and the GraphQL
// branch distils its rich node tree to the same shape via `graphqlToData`
// (`graphqlNodesToNaggPage`, see `src/map/graphql.ts`) BEFORE the parse. So each
// `Nagg*Schema` below is the single `dataSchema` both transports converge on:
// `Schema.safeParse(<nagg REST body>)` and `Schema.safeParse(<distilled GraphQL
// data>)` succeed and produce deep-equal canonical objects. There is no
// per-transport normalize layer.
// ---------------------------------------------------------------------------

// A feed event uses second-resolution `created_at` (matching `NaggFeedEvent`),
// not the GraphQL `createdAt` ISO/ms timestamp — the REST payload emits the raw
// nostr event shape.
export const NaggFeedEventSchema = z
  .object({
    id: z.string(),
    kind: z.number().int(),
    pubkey: z.string(),
    content: z.string(),
    tags: z.array(z.array(z.string())),
    created_at: z.number(),
  })
  .passthrough();

export const NaggNoteMetricsSchema = z.object({
  likeCount: z.number(),
  repostCount: z.number(),
  replyCount: z.number(),
  satsZapped: z.number(),
});

/**
 * A page's hydration side-map (metrics / profiles / quoted), tolerant of the
 * server omitting it or sending JSON `null`. A Go `nil` map serializes to `null`,
 * not `{}`, so an empty thread (root with no replies/stats) would otherwise fail
 * `z.record` validation and silently drop the whole tier — the cause of nagg
 * never answering the thread surface. Default to an empty map instead.
 */
function hydrationMap<T extends z.ZodTypeAny>(value: T) {
  return z
    .record(z.string(), value)
    .nullish()
    .transform((map): Record<string, z.infer<T>> => map ?? {});
}

export const NaggProfileInfoSchema = z
  .object({
    name: z.string(),
    picture: z.string().optional(),
  })
  .passthrough();

export const NaggReposterInfoSchema = z.object({
  pubkey: z.string(),
  event: NaggFeedEventSchema,
});

export const NaggFeedItemSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('note'),
    event: NaggFeedEventSchema,
    rootEvent: NaggFeedEventSchema.nullable().optional(),
    rootEventId: z.string().optional(),
    replyPreviewEvents: z.array(NaggFeedEventSchema).optional(),
  }),
  z.object({
    type: z.literal('repost'),
    repostEvent: NaggFeedEventSchema,
    originalEvent: NaggFeedEventSchema.nullable().optional(),
    originalEventId: z.string().optional(),
    rootEvent: NaggFeedEventSchema.nullable().optional(),
    rootEventId: z.string().optional(),
    reposters: z.array(NaggReposterInfoSchema).optional(),
  }),
]);

export const NaggFeedPageSchema = z.object({
  items: z.array(NaggFeedItemSchema),
  // Server-authoritative render order + semantic; present on the REST app-view
  // (the GraphQL path omits it, so the facade derives it from item order).
  ordering: NaggOrderingSchema.optional(),
  metrics: hydrationMap(NaggNoteMetricsSchema),
  profiles: hydrationMap(NaggProfileInfoSchema),
  quoted: hydrationMap(NaggFeedEventSchema),
  paginationUntil: z.number(),
  paginationOffset: z.number(),
});

// Thread: the root event plus its ordered descendant events, sharing the same
// metrics/profiles/quoted hydration the feed uses.
export const NaggThreadSchema = z.object({
  root: NaggFeedEventSchema,
  events: z.array(NaggFeedEventSchema),
  ordering: NaggOrderingSchema.optional(),
  metrics: hydrationMap(NaggNoteMetricsSchema),
  profiles: hydrationMap(NaggProfileInfoSchema),
  quoted: hydrationMap(NaggFeedEventSchema),
});

// One actor in a grouped notification (a follower / reposter / reactor /
// zapper), carried as a sample so the UI can render an avatar cluster without
// the full member list.
export const NaggNotificationActorSchema = z
  .object({
    pubkey: z.string(),
    eventId: z.string(),
    createdAt: z.number(),
    actorVertexScore: z.number().optional(),
  })
  .passthrough();

// Notifications canonical connection. The nodes carry the feed-event payload
// plus the ranking metadata (reason, actorVertexScore) the GraphQL
// notifications resolver exposes; metrics/profiles/quoted ride alongside as
// page-level hydration side maps (the REST app-view supplies them, and the
// GraphQL query embeds the equivalent per node).
//
// The REST app-view additionally groups follow/repost/reaction/zap items: a
// node with `type: "group"` represents many collapsed notifications, carrying a
// `total`, up to three `sampleActors`, and (for repost/reaction/zap) the
// `targetEvent`. reply/quote/mention stay `type: "single"`. The GraphQL path
// omits these fields (it is per-event), so they are all optional.
// targetEvent / targetEventId ride through `.passthrough()` (the GraphQL mapper
// injects them from references; the REST app-view emits them inline) and are
// read by consumers via a cast, so they stay off the explicit shape.
export const NaggNotificationNodeSchema = z
  .object({
    type: z.enum(["single", "group"]).optional(),
    event: NaggFeedEventSchema,
    reason: z.string(),
    actorVertexScore: z.number(),
    total: z.number().optional(),
    totalCapped: z.boolean().optional(),
    sampleActors: z.array(NaggNotificationActorSchema).optional(),
  })
  .passthrough();

export const NaggNotificationsPageSchema = z.object({
  notifications: z.object({
    nodes: z.array(NaggNotificationNodeSchema),
    pageInfo: z
      .object({
        endCursor: z.unknown().optional(),
        hasNextPage: z.boolean().optional(),
      })
      .optional(),
  }),
  metrics: hydrationMap(NaggNoteMetricsSchema),
  profiles: hydrationMap(NaggProfileInfoSchema),
  quoted: hydrationMap(NaggFeedEventSchema),
});

// Note stats: per-id aggregate metrics, keyed by event id.
export const NaggNoteStatsSchema = z.record(z.string(), NaggNoteMetricsSchema);

// DM envelope data (zero-knowledge — raw encrypted events for client decrypt).
// Enrichment side-maps only (no events) — `/nostr/events` and `/nostr/profiles`.
export const NaggEnrichmentSchema = z.object({
  metrics: hydrationMap(NaggNoteMetricsSchema),
  profiles: hydrationMap(NaggProfileInfoSchema),
  quoted: hydrationMap(NaggFeedEventSchema),
});

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
export type NaggFeedEventShape = z.infer<typeof NaggFeedEventSchema>;
export type NaggNoteMetricsShape = z.infer<typeof NaggNoteMetricsSchema>;
export type NaggProfileInfoShape = z.infer<typeof NaggProfileInfoSchema>;
export type NaggFeedItemShape = z.infer<typeof NaggFeedItemSchema>;
export type NaggFeedPage = z.infer<typeof NaggFeedPageSchema>;
export type NaggThread = z.infer<typeof NaggThreadSchema>;
export type NaggNotificationActor = z.infer<typeof NaggNotificationActorSchema>;
export type NaggNotificationNode = z.infer<typeof NaggNotificationNodeSchema>;
export type NaggNotificationsPage = z.infer<typeof NaggNotificationsPageSchema>;
export type NaggNoteStats = z.infer<typeof NaggNoteStatsSchema>;
