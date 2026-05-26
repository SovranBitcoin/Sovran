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
export function parseHistoryEntryOnce(raw: string | null | undefined): ParsedHistoryEntry | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ParsedHistoryEntry;
  } catch (e) {
    logger.warn('historyEntry.parseFailed', { error: errField(e) });
    return null;
  }
}
