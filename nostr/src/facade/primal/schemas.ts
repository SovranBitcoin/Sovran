import { z } from 'zod';

import { NostrHexId } from '../../schemas';

/** An id Primal names in passing: one that is not an id is read as absent. */
const optionalId = NostrHexId.optional().catch(undefined);
/** A user-authored display field: dropped on its own when too long. */
const displayText = (max: number) => z.string().max(max).optional().catch(undefined);

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
  event_id: NostrHexId,
  likes: z.number().optional(),
  replies: z.number().optional(),
  reposts: z.number().optional(),
  zaps: z.number().optional(),
  satszapped: z.number().optional(),
});
export type PrimalNoteStatsContent = z.infer<typeof PrimalNoteStatsContent>;

/** kind 10000115 — per-viewer action overlay. */
export const PrimalNoteActionsContent = z.object({
  event_id: NostrHexId,
  replied: z.boolean().optional(),
  liked: z.boolean().optional(),
  reposted: z.boolean().optional(),
  zapped: z.boolean().optional(),
  bookmarked: z.boolean().optional(),
});
export type PrimalNoteActionsContent = z.infer<typeof PrimalNoteActionsContent>;

/** kind 10000113 — the ordering manifest (FeedRange). */
export const PrimalFeedRangeContent = z.object({
  order_by: z.string().max(64).optional(),
  since: z.number().optional(),
  until: z.number().optional(),
  // Event ids, read one by one: one that is not an id is left out of the order.
  elements: z
    .array(z.unknown())
    .transform((items) =>
      items.slice(0, 5000).filter((item): item is string => NostrHexId.safeParse(item).success),
    ),
});
export type PrimalFeedRangeContent = z.infer<typeof PrimalFeedRangeContent>;

/** kind 10000105 — USER_PROFILE aggregate stats (counts + `time_joined`). */
export const PrimalUserProfileContent = z.object({
  pubkey: optionalId,
  follows_count: z.number().optional(),
  followers_count: z.number().optional(),
  note_count: z.number().optional(),
  time_joined: z.number().nullish(),
});
export type PrimalUserProfileContent = z.infer<typeof PrimalUserProfileContent>;

/** kind 0 — profile metadata (the standard NIP-01 content JSON). */
export const PrimalProfileContent = z
  .object({
    name: displayText(256),
    display_name: displayText(256),
    displayName: displayText(256),
    picture: displayText(2048),
  })
  .passthrough();
export type PrimalProfileContent = z.infer<typeof PrimalProfileContent>;

/**
 * kind 10000132 — Primal notification summary.
 *
 * NOTE (capability assumption): the live primal-server exposes a
 * `get_notifications` cache verb returning these synthetic summaries plus the
 * referenced kind-1s and kind-0 user infos. This shape is modeled from the
 * primal-server reference, NOT pinned against the live cache. Validation is
 * strict enough that shape drift skips a summary rather than fabricating a
 * row; a batch with zero usable summaries makes the tier answer
 * `unsupported`, so a concurrent notifications read proceeds on the other
 * sources.
 */
export const PrimalNotificationContent = z
  .object({
    pubkey: NostrHexId, // the notified viewer
    created_at: z.number(),
    type: z.number(), // primal-server notification type code
    follower: optionalId,
    your_post: optionalId,
    who_liked_it: optionalId,
    who_reposted_it: optionalId,
    who_zapped_it: optionalId,
    who_replied_to_it: optionalId,
    reply: optionalId,
    you_were_mentioned_in: optionalId,
    your_post_were_mentioned_in: optionalId,
    satszapped: z.number().optional(),
  })
  .passthrough();
export type PrimalNotificationContent = z.infer<typeof PrimalNotificationContent>;

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
