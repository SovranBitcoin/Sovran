import { z } from 'zod';

import { NostrHexId } from '../../schemas';

/** An id Primal names in passing: one that is not an id is read as absent. */
const optionalId = NostrHexId.optional().catch(undefined);

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

/** kind 10000105 — USER_PROFILE aggregate stats (counts + `time_joined`). */
export const PrimalUserProfileContent = z.object({
  pubkey: optionalId,
  follows_count: z.number().optional(),
  followers_count: z.number().optional(),
  note_count: z.number().optional(),
  time_joined: z.number().nullish(),
});
export type PrimalUserProfileContent = z.infer<typeof PrimalUserProfileContent>;

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
