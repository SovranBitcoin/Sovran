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
import { nostrLog } from '../../log';
import type { FeedBundle, FeedItem } from '../feed';
import type { ThreadBundle } from '../thread';
import { bundleFromOwnEvents, ownActionKinds, type OwnHistoryBundle } from '../own-state';
import type { OwnActionType } from '@sovranbitcoin/schemas';
import { PRIMAL_KIND, type RawPrimalEvent } from './protocol';
import {
  PrimalNoteStatsContent,
  PrimalNoteActionsContent,
  PrimalFeedRangeContent,
  PrimalProfileContent,
  parseContent,
} from './schemas';

// ---------------------------------------------------------------------------
// Primal demux
//
// Turn one collected batch of mixed-kind Primal events into a contract bundle
// (the SAME shape the nagg tier produces), so the facade orders and renders it
// identically regardless of which tier answered. Notes become items; kind 0
// becomes profiles; the synthetic kinds become the stats map, the viewer
// overlay, and the ordering manifest. Everything is validated at ingest; an
// event that fails validation is skipped, never crashes the batch. The feed and
// thread surfaces share one batch parser and assemble their bundle differently.
// ---------------------------------------------------------------------------

type PrimalBatch = {
  notesById: Map<string, NaggFeedEvent>;
  stats: NoteStatsMap;
  actions: NoteActionsMap;
  profiles: Record<string, NaggProfileInfo>;
  feedRange: OrderingManifest | null;
};

function parsePrimalBatch(events: ReadonlyArray<RawPrimalEvent>): PrimalBatch {
  const notesById = new Map<string, NaggFeedEvent>();
  const stats: Record<string, NoteStats> = {};
  const actions: Record<string, NoteActions> = {};
  const profiles: Record<string, NaggProfileInfo> = {};
  let feedRange: OrderingManifest | null = null;

  for (const raw of events) {
    switch (raw.kind) {
      case PRIMAL_KIND.note: {
        const event = toFeedEvent(raw);
        if (event && !notesById.has(event.id)) notesById.set(event.id, event);
        break;
      }
      case PRIMAL_KIND.metadata: {
        if (!raw.pubkey) break;
        const profile = parseContent(PrimalProfileContent, raw.content);
        if (!profile) break;
        profiles[raw.pubkey] = {
          name: profile.display_name ?? profile.displayName ?? profile.name ?? '',
          ...(profile.picture ? { picture: profile.picture } : {}),
        };
        break;
      }
      case PRIMAL_KIND.noteStats: {
        const parsed = parseContent(PrimalNoteStatsContent, raw.content);
        if (!parsed) break;
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
        if (!parsed) break;
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
        if (!parsed) break;
        feedRange = {
          orderBy: parsed.order_by === 'created_at' ? 'created_at' : 'rank',
          elements: parsed.elements,
        };
        break;
      }
      default:
        // top zaps (9735), user stats, referenced events — not part of these bundles yet
        break;
    }
  }

  return { notesById, stats, actions, profiles, feedRange };
}

export function demuxPrimalFeed(events: ReadonlyArray<RawPrimalEvent>): FeedBundle {
  const batch = parsePrimalBatch(events);
  nostrLog.debug('nostr.primal.demux.feed', {
    rawEvents: events.length,
    notes: batch.notesById.size,
    profiles: Object.keys(batch.profiles).length,
    stats: Object.keys(batch.stats).length,
    actions: Object.keys(batch.actions).length,
    serverManifest: !!batch.feedRange,
  });
  const itemsById = new Map<string, FeedItem>();
  for (const [id, event] of batch.notesById) itemsById.set(id, { type: 'note', event });

  // Prefer Primal's authoritative manifest; otherwise synthesize one from the
  // notes we received so the bundle still renders by a stable order.
  const manifest = batch.feedRange ?? recencyOf(batch.notesById);
  const hasActions = Object.keys(batch.actions).length > 0;

  return {
    itemsById,
    manifest,
    stats: batch.stats,
    ...(hasActions ? { actions: batch.actions } : {}),
    profiles: batch.profiles,
    quoted: {},
    cursor: deriveCursor(manifest, batch.notesById),
  };
}

export function demuxPrimalThread(events: ReadonlyArray<RawPrimalEvent>, rootId: string): ThreadBundle | null {
  const batch = parsePrimalBatch(events);
  const root = batch.notesById.get(rootId);
  if (!root) return null; // no root → not a usable thread; let the tier fall through

  const itemsById = new Map<string, FeedItem>();
  const repliesById = new Map<string, NaggFeedEvent>();
  for (const [id, event] of batch.notesById) {
    if (id === rootId) continue;
    itemsById.set(id, { type: 'note', event });
    repliesById.set(id, event);
  }

  // Render EVERY reply. Primal's thread feedRange is the primary-note /
  // pagination window, NOT the reply list — using it to order/filter replies
  // drops them all (manifest references the root, not the replies). So keep any
  // feedRange order that actually points at a reply, then append the remaining
  // replies by recency. The app post-sorts replies anyway; what matters here is
  // that no reply in the batch is left out of the manifest.
  const recency = recencyOf(repliesById);
  const ordered = (batch.feedRange?.elements ?? []).filter((id) => repliesById.has(id));
  const seen = new Set(ordered);
  const manifest: OrderingManifest = {
    orderBy: batch.feedRange?.orderBy ?? recency.orderBy,
    elements: [...ordered, ...recency.elements.filter((id) => !seen.has(id))],
  };
  const hasActions = Object.keys(batch.actions).length > 0;

  return {
    root: { type: 'note', event: root },
    itemsById,
    manifest,
    stats: batch.stats,
    ...(hasActions ? { actions: batch.actions } : {}),
    profiles: batch.profiles,
    quoted: {},
    cursor: deriveCursor(manifest, repliesById),
  };
}

/** Collect the viewer's own events of the action's kind(s) from a Primal batch. */
export function demuxPrimalOwnHistory(
  events: ReadonlyArray<RawPrimalEvent>,
  actionType: OwnActionType,
): OwnHistoryBundle {
  const kinds = new Set(ownActionKinds(actionType));
  const own: NaggFeedEvent[] = [];
  for (const raw of events) {
    if (!kinds.has(raw.kind)) continue;
    const event = toFeedEvent(raw);
    if (event) own.push(event);
  }
  return bundleFromOwnEvents(own);
}

function recencyOf(notesById: Map<string, NaggFeedEvent>): OrderingManifest {
  return synthesizeRecencyManifest([...notesById.values()].map((e) => ({ id: e.id, created_at: e.created_at })));
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
