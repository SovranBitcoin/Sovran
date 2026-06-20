import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primal synthetic-kind wire shapes
//
// Primal encodes its synthetic events' payload as a JSON string in `content`.
// These schemas validate that payload at ingest — the cache never sees an
// unvalidated Primal event. Fields are optional/tolerant because this is an
// EXTERNAL protocol we model from reference: a missing count defaults sanely
// downstream rather than rejecting the whole batch. Exact field names are
// pinned against the live Primal cache during integration.
// ---------------------------------------------------------------------------

/** kind 10000100 — viewer-independent counts. */
export const PrimalNoteStatsContent = z.object({
  event_id: z.string(),
  likes: z.number().optional(),
  replies: z.number().optional(),
  reposts: z.number().optional(),
  zaps: z.number().optional(),
  satszapped: z.number().optional(),
});
export type PrimalNoteStatsContent = z.infer<typeof PrimalNoteStatsContent>;

/** kind 10000115 — per-viewer action overlay. */
export const PrimalNoteActionsContent = z.object({
  event_id: z.string(),
  replied: z.boolean().optional(),
  liked: z.boolean().optional(),
  reposted: z.boolean().optional(),
  zapped: z.boolean().optional(),
  bookmarked: z.boolean().optional(),
});
export type PrimalNoteActionsContent = z.infer<typeof PrimalNoteActionsContent>;

/** kind 10000113 — the ordering manifest (FeedRange). */
export const PrimalFeedRangeContent = z.object({
  order_by: z.string().optional(),
  since: z.number().optional(),
  until: z.number().optional(),
  elements: z.array(z.string()),
});
export type PrimalFeedRangeContent = z.infer<typeof PrimalFeedRangeContent>;

/** kind 0 — profile metadata (the standard NIP-01 content JSON). */
export const PrimalProfileContent = z
  .object({
    name: z.string().optional(),
    display_name: z.string().optional(),
    displayName: z.string().optional(),
    picture: z.string().optional(),
  })
  .passthrough();
export type PrimalProfileContent = z.infer<typeof PrimalProfileContent>;

/** Parse a synthetic event's JSON `content` with a schema; null on any failure. */
export function parseContent<T>(schema: z.ZodType<T>, content: string | undefined): T | null {
  if (typeof content !== 'string' || content.length === 0) return null;
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return null;
  }
  const result = schema.safeParse(json);
  return result.success ? result.data : null;
}
