import type {
  NoteStats,
  NoteActions,
  NoteStatsMap,
  NoteActionsMap,
  OrderingManifest,
  NostrCursor,
} from '@sovranbitcoin/schemas';
import type { NaggFeedEvent, NaggProfileInfo, NaggReposterInfo } from '../../map/feed';
import { synthesizeRecencyManifest } from '../../tiers';
import { toFeedEvent, type RawWireEvent } from '../event';
import { nostrLog } from '../../log';
import type { FeedBundle, FeedItem } from '../feed';
import { ancestorParents, type ThreadBundle } from '../thread';
import { bundleFromOwnEvents, ownActionKinds, type OwnHistoryBundle } from '../own-state';
import type { OwnActionType } from '@sovranbitcoin/schemas';
import { profilesFromKind0, type ProfileMetadata } from '../profiles';
import type { ProfileStatsBundle } from '../profile-stats';
import { socialGraphFromEvents, type SocialGraph } from '../social-graph';
import { PRIMAL_KIND, type RawPrimalEvent } from './protocol';
import {
  PrimalNoteStatsContent,
  PrimalNoteActionsContent,
  PrimalFeedRangeContent,
  PrimalProfileContent,
  PrimalUserProfileContent,
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

// A repost collapsed onto its original. Primal keys the feed item by the
// ORIGINAL note id (megaFeed.ts convertToNotesMega: `id = parseRepost(note).id`)
// and carries the reposter(s) as metadata, so we do the same.
type PrimalRepost = {
  repostEvent: NaggFeedEvent;
  originalEvent: NaggFeedEvent | null;
  originalEventId: string;
  reposters: NaggReposterInfo[];
};

type PrimalBatch = {
  notesById: Map<string, NaggFeedEvent>;
  repostsByOriginalId: Map<string, PrimalRepost>;
  stats: NoteStatsMap;
  actions: NoteActionsMap;
  profiles: Record<string, NaggProfileInfo>;
  feedRange: OrderingManifest | null;
};

/** Primal inlines the reposted note as stringified JSON in the kind-6 content. */
function parseRepostOriginal(content: string): NaggFeedEvent | null {
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as RawWireEvent;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.kind !== 'number') return null;
    return toFeedEvent(parsed);
  } catch {
    return null;
  }
}

function parsePrimalBatch(events: ReadonlyArray<RawPrimalEvent>): PrimalBatch {
  const notesById = new Map<string, NaggFeedEvent>();
  const repostsByOriginalId = new Map<string, PrimalRepost>();
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
      case PRIMAL_KIND.repost:
      case PRIMAL_KIND.genericRepost: {
        const repostEvent = toFeedEvent(raw);
        if (!repostEvent) break;
        // The reposted note is inline in the content; the `e` tag is the fallback id.
        const originalEvent = parseRepostOriginal(repostEvent.content);
        const originalEventId = originalEvent?.id ?? repostEvent.tags.find((t) => t[0] === 'e')?.[1];
        if (!originalEventId) break;
        const reposter: NaggReposterInfo = { pubkey: repostEvent.pubkey, event: repostEvent };
        const existing = repostsByOriginalId.get(originalEventId);
        if (existing) {
          // Several people reposted the same note → one item, many reposters.
          existing.reposters.push(reposter);
          if (!existing.originalEvent && originalEvent) existing.originalEvent = originalEvent;
        } else {
          repostsByOriginalId.set(originalEventId, {
            repostEvent,
            originalEvent: originalEvent ?? null,
            originalEventId,
            reposters: [reposter],
          });
        }
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

  return { notesById, repostsByOriginalId, stats, actions, profiles, feedRange };
}

export function demuxPrimalFeed(events: ReadonlyArray<RawPrimalEvent>): FeedBundle {
  const batch = parsePrimalBatch(events);
  nostrLog.debug('nostr.primal.demux.feed', {
    rawEvents: events.length,
    notes: batch.notesById.size,
    reposts: batch.repostsByOriginalId.size,
    profiles: Object.keys(batch.profiles).length,
    stats: Object.keys(batch.stats).length,
    actions: Object.keys(batch.actions).length,
    serverManifest: !!batch.feedRange,
  });
  const itemsById = new Map<string, FeedItem>();
  // Feed position per item id, for the recency fallback + cursor (a repost's
  // position is WHEN it was reposted, i.e. the kind-6 created_at).
  const timestampsById = new Map<string, number>();
  // A feedRange may reference a repost by either the original id (Primal's
  // canonical item id) or the kind-6 event id — alias both to the original.
  const idAlias = new Map<string, string>();

  // Reposts win over a bare copy of the reposted note: Primal sends the original
  // as a reference (page.mentions), not its own feed row.
  for (const [originalId, repost] of batch.repostsByOriginalId) {
    itemsById.set(originalId, {
      type: 'repost',
      repostEvent: repost.repostEvent,
      originalEvent: repost.originalEvent ?? batch.notesById.get(originalId) ?? null,
      originalEventId: originalId,
      reposters: repost.reposters,
    });
    timestampsById.set(originalId, repost.repostEvent.created_at);
    idAlias.set(repost.repostEvent.id, originalId);
  }
  for (const [id, event] of batch.notesById) {
    if (itemsById.has(id)) continue; // already represented as a repost's original
    itemsById.set(id, { type: 'note', event });
    timestampsById.set(id, event.created_at);
  }

  // Prefer Primal's authoritative manifest (resolved through the repost alias and
  // filtered to items we actually hold); otherwise synthesize one by recency.
  const manifest = batch.feedRange
    ? resolveManifest(batch.feedRange, itemsById, idAlias)
    : synthesizeRecencyManifest([...timestampsById].map(([id, created_at]) => ({ id, created_at })));
  const hasActions = Object.keys(batch.actions).length > 0;

  return {
    itemsById,
    manifest,
    stats: batch.stats,
    ...(hasActions ? { actions: batch.actions } : {}),
    profiles: batch.profiles,
    quoted: {},
    cursor: deriveCursorByTimestamp(manifest, timestampsById),
  };
}

/** Map feedRange ids through the repost alias, drop unknowns, dedupe — so a
 *  repost referenced by its kind-6 id or original id lands on the same item. */
function resolveManifest(
  feedRange: OrderingManifest,
  itemsById: Map<string, FeedItem>,
  idAlias: Map<string, string>,
): OrderingManifest {
  const seen = new Set<string>();
  const elements: string[] = [];
  for (const raw of feedRange.elements) {
    const id = itemsById.has(raw) ? raw : idAlias.get(raw);
    if (!id || seen.has(id) || !itemsById.has(id)) continue;
    seen.add(id);
    elements.push(id);
  }
  return { orderBy: feedRange.orderBy, elements };
}

/** Cursor = the oldest rendered item's (created_at, id) — its feed-position
 *  timestamp, which for a repost is the kind-6 created_at, not the original's. */
function deriveCursorByTimestamp(
  manifest: OrderingManifest,
  timestampsById: Map<string, number>,
): NostrCursor {
  for (let i = manifest.elements.length - 1; i >= 0; i--) {
    const id = manifest.elements[i];
    const createdAt = timestampsById.get(id);
    if (createdAt !== undefined) return { createdAt, id };
  }
  return null;
}

export function demuxPrimalThread(events: ReadonlyArray<RawPrimalEvent>, rootId: string): ThreadBundle | null {
  const batch = parsePrimalBatch(events);
  const root = batch.notesById.get(rootId);
  if (!root) return null; // no root → not a usable thread; let the tier fall through

  // Primal's thread response carries the ancestors too; classify them as parents
  // (not replies) so the parent chain renders and caches.
  const { parents, ancestorIds } = ancestorParents(batch.notesById, rootId);

  const itemsById = new Map<string, FeedItem>();
  const repliesById = new Map<string, NaggFeedEvent>();
  for (const [id, event] of batch.notesById) {
    if (id === rootId || ancestorIds.has(id)) continue;
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
    parents,
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

/**
 * `user_profile` batch → one profile's header. The real kind-0 gives metadata;
 * the synthetic USER_PROFILE (10000105) gives follow/follower/note counts and
 * `time_joined` (joined date). Both are keyed to the requested pubkey.
 */
export function demuxPrimalProfileStats(
  events: ReadonlyArray<RawPrimalEvent>,
  pubkey: string,
): ProfileStatsBundle {
  const metadata: ProfileMetadata | undefined = profilesFromKind0(events)[pubkey];
  let followersCount: number | undefined;
  let followingCount: number | undefined;
  let noteCount: number | undefined;
  let joinedAt: number | undefined;

  for (const raw of events) {
    if (raw.kind !== PRIMAL_KIND.userStats) continue;
    const stats = parseContent(PrimalUserProfileContent, raw.content);
    if (!stats || (stats.pubkey && stats.pubkey !== pubkey)) continue;
    if (stats.followers_count != null) followersCount = stats.followers_count;
    if (stats.follows_count != null) followingCount = stats.follows_count;
    if (stats.note_count != null) noteCount = stats.note_count;
    if (stats.time_joined != null) joinedAt = stats.time_joined;
  }

  return {
    pubkey,
    ...(metadata ? { metadata } : {}),
    ...(followersCount !== undefined ? { followersCount } : {}),
    ...(followingCount !== undefined ? { followingCount } : {}),
    ...(noteCount !== undefined ? { noteCount } : {}),
    ...(joinedAt !== undefined ? { joinedAt } : {}),
  };
}

/**
 * `contact_list` (extended_response) batch → the profile's follow set plus the
 * bundled kind-0s of who it follows. Reuses the floor's kind-3 parser, then
 * layers the followed users' profiles on top from the extended payload.
 */
export function demuxPrimalSocialGraph(
  events: ReadonlyArray<RawPrimalEvent>,
  pubkey: string,
): SocialGraph {
  const feedEvents: NaggFeedEvent[] = [];
  for (const raw of events) {
    const event = toFeedEvent(raw);
    if (event) feedEvents.push(event);
  }
  const graph = socialGraphFromEvents(pubkey, feedEvents);
  const profiles: Record<string, NaggProfileInfo> = {};
  for (const [pk, m] of Object.entries(profilesFromKind0(events))) {
    profiles[pk] = { name: m.displayName || m.name || '', ...(m.picture ? { picture: m.picture } : {}) };
  }
  return { ...graph, profiles };
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
