/**
 * Shared cursor helpers for nagg DM pagination. The pagination cursor MUST use
 * the envelope (gift-wrap) `createdAt`, NOT the decrypted rumor time: NIP-59
 * randomizes the wrap timestamp up to ~2 days away from the real send time, and
 * nagg orders/filters by the wrap timestamp. Overlap only its last second
 * (the server uses an exclusive bound), deduplicating by envelope ID.
 */
import { envelopeUnixSeconds, type DmEnvelopePage } from './dmEnvelopeTypes';

/** Oldest envelope (wrap) timestamp in a page — the correct `until` cursor. */
function pageOldestWrapSec(page: DmEnvelopePage): number | undefined {
  let oldestSec: number | undefined;
  for (const envelope of page.envelopes) {
    const wrapSec = Math.floor(envelopeUnixSeconds(envelope.createdAt));
    if (wrapSec > 0 && (oldestSec === undefined || wrapSec < oldestSec)) oldestSec = wrapSec;
  }
  return oldestSec;
}

/**
 * Cursor state for walking the shared gift-wrap inbox backwards.
 *
 * Both DM paginators (the conversation list and a single thread) need the same
 * three things per page — count the envelopes they hadn't seen, keep the oldest
 * wrap time across ALL pages, and turn that into the next `until` — plus the
 * inclusive boundary above. Keeping them together means a caller can't apply the
 * slack to a per-page minimum by mistake.
 */
export interface DmEnvelopeCursor {
  /** Record a page; returns how many of its envelopes were previously unseen. */
  track(page: DmEnvelopePage): number;
  /** `until` for the next (older) page, or undefined while nothing is tracked. */
  nextUntil(): number | undefined;
}

export function createDmEnvelopeCursor(): DmEnvelopeCursor {
  const seenWrapIds = new Set<string>();
  let oldestWrapSec: number | undefined;

  return {
    track(page) {
      let fresh = 0;
      for (const envelope of page.envelopes) {
        if (!seenWrapIds.has(envelope.id)) {
          seenWrapIds.add(envelope.id);
          fresh += 1;
        }
      }
      const oldestSec = pageOldestWrapSec(page);
      if (oldestSec !== undefined) {
        oldestWrapSec =
          oldestWrapSec === undefined ? oldestSec : Math.min(oldestWrapSec, oldestSec);
      }
      return fresh;
    },
    nextUntil() {
      return oldestWrapSec === undefined ? undefined : oldestWrapSec + 1;
    },
  };
}
