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
function envelopeUnixSeconds(createdAt: DmEnvelope['createdAt']): number {
  if (typeof createdAt === 'number') {
    return createdAt > 1e12 ? Math.floor(createdAt / 1000) : Math.floor(createdAt);
  }
  const ms = createdAt instanceof Date ? createdAt.getTime() : Date.parse(createdAt);
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
}

/** Oldest envelope (wrap) timestamp in a page — the correct `until` cursor. */
function pageOldestWrapTs(page: DmEnvelopePage): number | undefined {
  let oldest: number | undefined;
  for (const envelope of page.envelopes) {
    const ts = envelopeUnixSeconds(envelope.createdAt);
    if (ts > 0 && (oldest === undefined || ts < oldest)) oldest = ts;
  }
  return oldest;
}

/**
 * Cursor state for walking the shared gift-wrap inbox backwards.
 *
 * Both DM paginators (the conversation list and a single thread) need the same
 * three things per page — count the envelopes they hadn't seen, keep the oldest
 * wrap time across ALL pages, and turn that into the next `until` — plus the
 * slack correction above. Keeping them together means a caller can't apply the
 * slack to a per-page minimum by mistake.
 */
interface DmEnvelopeCursor {
  /** Forget every tracked envelope — for a fresh first page. */
  reset(): void;
  /** Record a page; returns how many of its envelopes were previously unseen. */
  track(page: DmEnvelopePage): number;
  /** `until` for the next (older) page, or undefined while nothing is tracked. */
  nextUntil(): number | undefined;
}

export function createDmEnvelopeCursor(): DmEnvelopeCursor {
  let seenWrapIds = new Set<string>();
  let oldestWrapTs: number | undefined;

  return {
    reset() {
      seenWrapIds = new Set();
      oldestWrapTs = undefined;
    },
    track(page) {
      let fresh = 0;
      for (const envelope of page.envelopes) {
        if (!seenWrapIds.has(envelope.id)) {
          seenWrapIds.add(envelope.id);
          fresh += 1;
        }
      }
      const oldest = pageOldestWrapTs(page);
      if (oldest !== undefined) {
        oldestWrapTs = oldestWrapTs === undefined ? oldest : Math.min(oldestWrapTs, oldest);
      }
      return fresh;
    },
    nextUntil() {
      return oldestWrapTs === undefined ? undefined : oldestWrapTs + CURSOR_SLACK_SECONDS;
    },
  };
}
