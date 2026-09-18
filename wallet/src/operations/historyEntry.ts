// ---------------------------------------------------------------------------
// History entry parser — single canonical helper used everywhere a coco-core
// `historyEntry` JSON string is consumed. Centralises the parse + warn shape
// so callers don't re-parse the same string two or three times per confirm
// path (the previous shape parsed each entry up to 3x per branch).
// ---------------------------------------------------------------------------

import { z } from 'zod';

import { errField, logger } from '../logger';

/**
 * The fields colada reads from a history entry. Loose: every other coco-core
 * field (mintUrl, state, token, …) passes through untouched. `amount` is a
 * plain number in colada's own entries but a serialized coco `Amount` (a
 * string) when the row comes straight from coco's history.
 */
const ParsedHistoryEntrySchema = z.looseObject({
  id: z.string().optional(),
  type: z.string().optional(),
  amount: z.union([z.number(), z.string()]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ParsedHistoryEntry = z.infer<typeof ParsedHistoryEntrySchema>;

function parseJson(raw: string): { ok: true; value: unknown } | { ok: false; error: unknown } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Parse a coco-core history entry JSON string exactly once per call site.
 * Returns `null` (and logs a structured warn) when the payload is malformed
 * JSON or doesn't match the entry schema, so callers can branch on a single
 * null check instead of nesting try/catch.
 */
export function parseHistoryEntryOnce(
  raw: string | null | undefined,
): ParsedHistoryEntry | null {
  if (!raw) {
    logger.debug('historyEntry.parseSkipped', {
      reason: raw == null ? 'nullish' : 'empty',
    });
    return null;
  }
  const json = parseJson(raw);
  if (!json.ok) {
    logger.warn('historyEntry.parseFailed', {
      rawLength: raw.length,
      error: errField(json.error),
    });
    return null;
  }
  const result = ParsedHistoryEntrySchema.safeParse(json.value);
  if (!result.success) {
    logger.warn('historyEntry.schemaMismatch', {
      rawLength: raw.length,
      issueCount: result.error.issues.length,
      issuePaths: result.error.issues.map((issue) => issue.path.join('.')),
    });
    return null;
  }
  const parsed = result.data;
  logger.debug('historyEntry.parseSucceeded', {
    rawLength: raw.length,
    keyCount: Object.keys(parsed).length,
    hasId: !!parsed.id,
    idLength: parsed.id?.length ?? 0,
    type: parsed.type ?? null,
    amount: parsed.amount ?? null,
    metadataKeyCount: parsed.metadata
      ? Object.keys(parsed.metadata).length
      : 0,
  });
  return parsed;
}
