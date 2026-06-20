import type { NaggFeedEvent } from '../map/feed';

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

/** Coerce an untrusted wire event into a `NaggFeedEvent`, or null if it lacks an id/pubkey. */
export function toFeedEvent(raw: RawWireEvent): NaggFeedEvent | null {
  if (typeof raw.id !== 'string' || typeof raw.pubkey !== 'string') return null;
  return {
    id: raw.id,
    kind: raw.kind,
    pubkey: raw.pubkey,
    content: typeof raw.content === 'string' ? raw.content : '',
    tags: coerceTags(raw.tags),
    created_at: typeof raw.created_at === 'number' ? raw.created_at : 0,
  };
}

/** Keep only well-formed `string[]` tags; drop anything malformed. */
export function coerceTags(tags: unknown): string[][] {
  if (!Array.isArray(tags)) return [];
  const out: string[][] = [];
  for (const tag of tags) {
    if (Array.isArray(tag) && tag.every((t) => typeof t === 'string')) {
      out.push(tag as string[]);
    }
  }
  return out;
}
