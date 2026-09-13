import type { NostrTier, NoteStats, NoteStatsMap } from '@sovranbitcoin/schemas';
import type { RequestControls } from '../timeout';
import type { ReadProvenance, TierOutcome } from '../tiers';
import type { NaggFeedEvent } from '../map/feed';
import { toNoteStats } from './noteStatsContract';

// ---------------------------------------------------------------------------
// Note stats surface — per-note engagement counts for ids a page did not carry.
//
// A relay-served feed page has no aggregates, and nagg omits zero values, so a
// row can honestly not know its counts. This read fills that gap for a bounded
// batch of ids: nagg's `POST /nostr/events/aggregates` is the gold path, the
// relay floor COUNTS reactions/reposts/replies/zaps referencing the ids (a
// lower bound, capped by the request limit). Results land in the entity cache
// under each tier's rank so a better source's numbers are never overwritten.
// ---------------------------------------------------------------------------

/** Max ids per read: keeps a relay `#e` filter and a nagg POST body bounded. */
export const NOTE_STATS_BATCH_MAX = 50;

export type NoteStatsRequest = RequestControls & {
  ids: string[];
  /** Bypass nagg's response cache (a pull-to-refresh). */
  refresh?: boolean;
};

export type ResolvedNoteStats = {
  tier: NostrTier;
  stats: NoteStatsMap;
  provenance?: ReadProvenance;
};

export interface NoteStatsTier {
  readonly tier: NostrTier;
  getNoteStats(request: NoteStatsRequest): Promise<TierOutcome<NoteStatsMap>>;
}

/** The note ids an event references through its `e` tags. */
function referencedNoteIds(event: NaggFeedEvent): string[] {
  const out: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] === 'e' && typeof tag[1] === 'string') out.push(tag[1]);
  }
  return out;
}

/**
 * Relay floor: count the engagement events that reference each requested id.
 * Reactions are kind 7 (a `-` content is a downvote, not a like), reposts kind
 * 6, replies kind 1 that reference the id, zap receipts kind 9735 (count only;
 * the sats total is not derivable without parsing the invoice). Every requested
 * id gets an entry, so a note with no engagement reads as zero — the relay DID
 * answer — rather than staying unknown.
 */
export function noteStatsFromRelayEvents(
  ids: readonly string[],
  events: readonly NaggFeedEvent[],
): NoteStatsMap {
  const wanted = new Set(ids);
  const counts = new Map<string, { likes: number; reposts: number; replies: number; zaps: number }>();
  for (const id of ids) counts.set(id, { likes: 0, reposts: 0, replies: 0, zaps: 0 });
  for (const event of events) {
    // Each referencing event counts once per referenced note it targets.
    const targets = new Set(referencedNoteIds(event).filter((id) => wanted.has(id)));
    for (const id of targets) {
      const c = counts.get(id)!;
      if (event.kind === 7) {
        if (event.content.trim() !== '-') c.likes += 1;
      } else if (event.kind === 6) c.reposts += 1;
      else if (event.kind === 1) c.replies += 1;
      else if (event.kind === 9735) c.zaps += 1;
    }
  }
  const out: Record<string, NoteStats> = {};
  for (const [id, c] of counts) out[id] = toNoteStats({ ...c, satsZapped: 0 });
  return out;
}

/** Split a large id list into facade-sized batches. */
export function noteStatsBatches(ids: readonly string[], size = NOTE_STATS_BATCH_MAX): string[][] {
  const unique = [...new Set(ids.filter((id) => id.length > 0))];
  const out: string[][] = [];
  for (let i = 0; i < unique.length; i += size) out.push(unique.slice(i, i + size));
  return out;
}
