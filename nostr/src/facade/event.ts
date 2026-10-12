import type { NaggFeedEvent } from '../map/feed';
import { NOSTR_EVENT_LIMITS, NostrHexId } from '../schemas';

// ---------------------------------------------------------------------------
// Shared raw-event coercion
//
// Both the Primal and raw-relay tiers receive untrusted wire events and must
// turn the well-formed ones into the canonical `NaggFeedEvent`. One owner for
// that coercion so the floor isn't more gullible than the cache tier.
// ---------------------------------------------------------------------------

/** A minimal untrusted event off any wire. */
export type RawWireEvent = {
  id?: string;
  pubkey?: string;
  kind: number;
  content?: string;
  tags?: unknown;
  created_at?: number;
};

const isHexId = (value: unknown): value is string => NostrHexId.safeParse(value).success;

/**
 * Coerce an untrusted wire event into a `NaggFeedEvent`, or null if its id or
 * pubkey is not 64 lowercase hex, its kind is not a number, or its content is
 * over the event ceiling: the same refusals the nagg envelope makes
 * (`NaggFeedEventSchema`), so a relay or a cache cannot hand over what the
 * backend could not.
 */
export function toFeedEvent(raw: RawWireEvent): NaggFeedEvent | null {
  if (!isHexId(raw.id) || !isHexId(raw.pubkey)) return null;
  if (typeof raw.kind !== 'number') return null;
  if (typeof raw.content === 'string' && raw.content.length > NOSTR_EVENT_LIMITS.content) {
    return null;
  }
  return {
    id: raw.id,
    kind: raw.kind,
    pubkey: raw.pubkey,
    content: typeof raw.content === 'string' ? raw.content : '',
    tags: coerceTags(raw.tags),
    created_at: typeof raw.created_at === 'number' ? raw.created_at : 0,
  };
}

/** Keep only well-formed `string[]` tags within the event ceilings; drop anything else. */
export function coerceTags(tags: unknown): string[][] {
  if (!Array.isArray(tags)) return [];
  const out: string[][] = [];
  for (const tag of tags) {
    if (out.length >= NOSTR_EVENT_LIMITS.tags) break;
    if (
      Array.isArray(tag) &&
      tag.length <= NOSTR_EVENT_LIMITS.tagElements &&
      tag.every((t) => typeof t === 'string' && t.length <= NOSTR_EVENT_LIMITS.tagElement)
    ) {
      out.push(tag as string[]);
    }
  }
  return out;
}
