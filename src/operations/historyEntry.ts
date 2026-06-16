// ---------------------------------------------------------------------------
// History entry parser — single canonical helper used everywhere a coco-core
// `historyEntry` JSON string is consumed. Centralises the try/catch + warn
// shape so callers don't re-parse the same string two or three times per
// confirm path (the previous shape parsed each entry up to 3x per branch).
// ---------------------------------------------------------------------------

import { errField, logger } from '../logger';

export interface ParsedHistoryEntry {
  id?: string;
  type?: string;
  amount?: number;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Parse a coco-core history entry JSON string exactly once per call site.
 * Returns `null` (and logs a structured warn) when the payload is malformed
 * so callers can branch on a single null check instead of nesting try/catch.
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
  try {
    const parsed = JSON.parse(raw) as ParsedHistoryEntry;
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
  } catch (e) {
    logger.warn('historyEntry.parseFailed', {
      rawLength: raw.length,
      error: errField(e),
    });
    return null;
  }
}
