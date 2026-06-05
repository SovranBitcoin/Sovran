/**
 * Shared cursor helpers for nagg DM pagination. The pagination cursor MUST use
 * the envelope (gift-wrap) `createdAt`, NOT the decrypted rumor time: NIP-59
 * randomizes the wrap timestamp up to ~2 days away from the real send time, and
 * nagg orders/filters by the wrap timestamp. We over-fetch by `CURSOR_SLACK_SECONDS`
 * and rely on wrap-id dedup to converge.
 */
import type { DmEnvelope, DmEnvelopePage } from './dmEnvelopeClient';

export const CURSOR_SLACK_SECONDS = 2 * 24 * 60 * 60;

/** Normalize an envelope `createdAt` (ISO string | unix seconds | ms | Date) to unix seconds. */
export function envelopeUnixSeconds(createdAt: DmEnvelope['createdAt']): number {
  if (typeof createdAt === 'number') {
    return createdAt > 1e12 ? Math.floor(createdAt / 1000) : Math.floor(createdAt);
  }
  const ms = createdAt instanceof Date ? createdAt.getTime() : Date.parse(createdAt);
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
}

/** Oldest envelope (wrap) timestamp in a page — the correct `until` cursor. */
export function pageOldestWrapTs(page: DmEnvelopePage): number | undefined {
  let oldest: number | undefined;
  for (const envelope of page.envelopes) {
    const ts = envelopeUnixSeconds(envelope.createdAt);
    if (ts > 0 && (oldest === undefined || ts < oldest)) oldest = ts;
  }
  return oldest;
}
