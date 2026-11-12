import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared primitives.
//
// nagg v2 collapsed every app-view route body into ONE generic envelope —
// `{ order, orderBy, events, aggregates, cursor? }` — parsed by the single
// envelope module (`src/envelope.ts`). The v1 per-route response schemas
// (feed page / thread / notifications page / note stats / enrichment / DM
// connections / follow-status / own-profiles / posts / wallpapers) are GONE:
// what remains here are the primitives shared across modules (the raw event
// and the friendly metrics/profile shapes).
// ---------------------------------------------------------------------------

/**
 * An event id or a public key on the wire: 32 bytes as lowercase hex (NIP-01).
 * Anything else is not an id, whatever the sender says, and is refused where
 * it is parsed instead of being carried into a cache or a filter.
 */
export const NostrHexId = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * Ceilings for what one event may carry. They are for refusing input built to
 * exhaust memory, not for policing content, so each sits well above what real
 * events hold: relays commonly cap a whole event at 64 to 512 KiB (NIP-11
 * `max_message_length`), the largest ordinary events are follow lists of a few
 * thousand `p` tags, and a tag rarely has more than a handful of elements.
 */
export const NOSTR_EVENT_LIMITS = {
  /** Characters of `content`. */
  content: 1_000_000,
  /** Tags on one event. */
  tags: 20_000,
  /** Elements in one tag. */
  tagElements: 64,
  /** Characters of one tag element (an `imeta` or a quoted event can be long). */
  tagElement: 65_536,
} as const;

// A raw nostr event as the v2 envelope carries it: second-resolution
// `created_at`, string-matrix tags, content verbatim.
export const NaggFeedEventSchema = z
  .object({
    id: NostrHexId,
    kind: z.number().int(),
    pubkey: NostrHexId,
    content: z.string().max(NOSTR_EVENT_LIMITS.content),
    tags: z
      .array(
        z
          .array(z.string().max(NOSTR_EVENT_LIMITS.tagElement))
          .max(NOSTR_EVENT_LIMITS.tagElements),
      )
      .max(NOSTR_EVENT_LIMITS.tags),
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

// A kind-0 is user-authored: an oversized name or picture is a bad field, not
// a bad profile, so each is dropped on its own (the caps match the identity
// schema in `src/envelope.ts`).
export const NaggProfileInfoSchema = z
  .object({
    name: z.string().max(256).catch(''),
    picture: z.string().max(2048).optional().catch(undefined),
  })
  .passthrough();
