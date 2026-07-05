import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared primitives.
//
// nagg v2 collapsed every app-view route body into ONE generic envelope —
// `{ order, orderBy, events, aggregates, cursor? }` — parsed by the single
// envelope module (`src/envelope.ts`). The v1 per-route response schemas
// (feed page / thread / notifications page / note stats / enrichment / DM
// connections / follow-status / own-profiles / posts / wallpapers) are GONE:
// what remains here are the primitives shared across modules (the raw event,
// the friendly metrics/profile shapes, the ordering manifest mirror, and the
// service-info capability probe).
// ---------------------------------------------------------------------------

// Local mirror of the shared @sovranbitcoin/schemas OrderingManifest. Defined in
// nagg-ts's own zod (not imported as a value) so composing it into local schemas
// keeps the inferred types portable — the symlinked shared package carries its
// own zod copy, and mixing the two breaks type emission.
export const NaggOrderingSchema = z.object({
  orderBy: z.enum(['rank', 'created_at', 'arrival']),
  elements: z.array(z.string()).max(5000),
});

// A raw nostr event as the v2 envelope carries it: second-resolution
// `created_at`, string-matrix tags, content verbatim.
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

// The friendly per-note metrics the facade exposes. v2 derives these from the
// envelope's aggregate rules (see `AGGREGATE_RULES` in `src/envelope.ts`);
// `zapCount`/`quoteCount` are new in v2 (v1's note stats had no discrete zap
// count) and optional so hand-built v1-era maps still typecheck.
export const NaggNoteMetricsSchema = z.object({
  likeCount: z.number(),
  repostCount: z.number(),
  replyCount: z.number(),
  satsZapped: z.number(),
  zapCount: z.number().optional(),
  quoteCount: z.number().optional(),
});

export const NaggProfileInfoSchema = z
  .object({
    name: z.string(),
    picture: z.string().optional(),
  })
  .passthrough();

// Service info / capability probe (GET /nostr/capabilities) — unchanged in v2.
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

export type NaggServiceInfo = z.infer<typeof NaggServiceInfoSchema>;
export type NaggFeedEventShape = z.infer<typeof NaggFeedEventSchema>;
export type NaggNoteMetricsShape = z.infer<typeof NaggNoteMetricsSchema>;
export type NaggProfileInfoShape = z.infer<typeof NaggProfileInfoSchema>;

/** Per-id friendly metrics map (v1's note-stats shape, now derived from
 *  `POST /nostr/events/aggregates` via `noteStatsFromEnvelope`). */
export type NaggNoteStats = Record<string, NaggNoteMetricsShape>;
