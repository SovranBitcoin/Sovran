import type {
  NoteStats,
  NoteActions,
  NoteStatsMap,
  NoteActionsMap,
  OrderingManifest,
  NostrCursor,
} from '@sovranbitcoin/schemas';
import type { NaggFeedEvent, NaggProfileInfo } from '../../map/feed';
import { synthesizeRecencyManifest } from '../../tiers';
import { toFeedEvent } from '../event';
import type { FeedBundle, FeedItem } from '../feed';
import { PRIMAL_KIND, type RawPrimalEvent } from './protocol';
import {
  PrimalNoteStatsContent,
  PrimalNoteActionsContent,
  PrimalFeedRangeContent,
  PrimalProfileContent,
  parseContent,
} from './schemas';

// ---------------------------------------------------------------------------
// Primal feed demux
//
// Turn one collected batch of mixed-kind Primal events into a contract
// `FeedBundle` (the SAME shape the nagg tier produces), so the facade orders and
// renders it identically regardless of which tier answered. Notes become items;
// kind 0 becomes profiles; the synthetic kinds become the stats map, the viewer
// overlay, and the ordering manifest. Everything is validated at ingest; an
// event that fails validation is skipped, never crashes the batch.
// ---------------------------------------------------------------------------

export function demuxPrimalFeed(events: ReadonlyArray<RawPrimalEvent>): FeedBundle {
  const itemsById = new Map<string, FeedItem>();
  const eventsById = new Map<string, NaggFeedEvent>();
  const stats: Record<string, NoteStats> = {};
  const actions: Record<string, NoteActions> = {};
  const profiles: Record<string, NaggProfileInfo> = {};
  let feedRange: OrderingManifest | null = null;

  for (const raw of events) {
    switch (raw.kind) {
      case PRIMAL_KIND.note: {
        const event = toFeedEvent(raw);
        if (!event) continue;
        if (!itemsById.has(event.id)) {
          itemsById.set(event.id, { type: 'note', event });
          eventsById.set(event.id, event);
        }
        break;
      }
      case PRIMAL_KIND.metadata: {
        if (!raw.pubkey) continue;
        const profile = parseContent(PrimalProfileContent, raw.content);
        if (!profile) continue;
        profiles[raw.pubkey] = {
          name: profile.display_name ?? profile.displayName ?? profile.name ?? '',
          ...(profile.picture ? { picture: profile.picture } : {}),
        };
        break;
      }
      case PRIMAL_KIND.noteStats: {
        const parsed = parseContent(PrimalNoteStatsContent, raw.content);
        if (!parsed) continue;
        stats[parsed.event_id] = {
          likes: parsed.likes ?? 0,
          reposts: parsed.reposts ?? 0,
          replies: parsed.replies ?? 0,
          zaps: parsed.zaps ?? 0,
          satsZapped: parsed.satszapped ?? 0,
        };
        break;
      }
      case PRIMAL_KIND.noteActions: {
        const parsed = parseContent(PrimalNoteActionsContent, raw.content);
        if (!parsed) continue;
        actions[parsed.event_id] = {
          liked: parsed.liked ?? false,
          reposted: parsed.reposted ?? false,
          replied: parsed.replied ?? false,
          zapped: parsed.zapped ?? false,
          bookmarked: parsed.bookmarked ?? false,
        };
        break;
      }
      case PRIMAL_KIND.feedRange: {
        const parsed = parseContent(PrimalFeedRangeContent, raw.content);
        if (!parsed) continue;
        feedRange = {
          orderBy: parsed.order_by === 'created_at' ? 'created_at' : 'rank',
          elements: parsed.elements,
        };
        break;
      }
      default:
        // top zaps (9735), user stats, referenced events — not needed for the feed bundle yet
        break;
    }
  }

  // Prefer Primal's authoritative manifest; otherwise synthesize one from the
  // notes we received so the bundle still renders by a stable order.
  const manifest =
    feedRange ?? synthesizeRecencyManifest([...eventsById.values()].map((e) => ({ id: e.id, created_at: e.created_at })));

  const hasActions = Object.keys(actions).length > 0;

  return {
    itemsById,
    manifest,
    stats,
    ...(hasActions ? { actions } : {}),
    profiles,
    quoted: {},
    cursor: deriveCursor(manifest, eventsById),
  };
}

/** Cursor = the oldest rendered item's (created_at, id), the page's tail position. */
function deriveCursor(manifest: OrderingManifest, eventsById: Map<string, NaggFeedEvent>): NostrCursor {
  for (let i = manifest.elements.length - 1; i >= 0; i--) {
    const id = manifest.elements[i];
    const event = eventsById.get(id);
    if (event) return { createdAt: event.created_at, id };
  }
  return null;
}
