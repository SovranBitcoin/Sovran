import type { NaggFeedEvent, NaggProfileInfo } from '../../map/feed';
import { synthesizeRecencyManifest } from '../../tiers';
import { nostrLog } from '../../log';
import { toFeedEvent } from '../event';
import type { FeedBundle, FeedItem } from '../feed';
import type { ThreadBundle } from '../thread';
import type {
  NotificationItem,
  NotificationsBundle,
  NotificationReplyScope,
  NotificationTab,
} from '../notifications';
import { bundleFromOwnEvents, type OwnHistoryBundle } from '../own-state';
import type { OwnActionType } from '@sovranbitcoin/schemas';
import type { RawRelayEvent } from './protocol';

// ---------------------------------------------------------------------------
// Raw-relay demux
//
// The floor is "a bit rough but functional": relays carry notes (kind 1) and
// profiles (kind 0), but no server-side aggregate counts and no per-viewer
// overlay. So a bundle has notes + profiles, EMPTY stats (engagement is lazy
// viewport-scoped by the app, never blocking the page), NO actions overlay, and
// a synthesized recency manifest — the same contract shape every other tier
// produces, so the facade renders it identically. Feed and thread share one
// parser and assemble differently.
// ---------------------------------------------------------------------------

const KIND_NOTE = 1;
const KIND_METADATA = 0;

type RelayBatch = {
  notesById: Map<string, NaggFeedEvent>;
  profiles: Record<string, NaggProfileInfo>;
};

export function parseRelayBatch(events: ReadonlyArray<RawRelayEvent>): RelayBatch {
  const notesById = new Map<string, NaggFeedEvent>();
  const profiles: Record<string, NaggProfileInfo> = {};

  for (const raw of events) {
    if (raw.kind === KIND_NOTE) {
      const event = toFeedEvent(raw);
      if (event && !notesById.has(event.id)) notesById.set(event.id, event);
    } else if (raw.kind === KIND_METADATA && typeof raw.pubkey === 'string') {
      profiles[raw.pubkey] = profileFromContent(raw.content);
    }
  }

  return { notesById, profiles };
}

export function demuxRelayFeed(events: ReadonlyArray<RawRelayEvent>): FeedBundle {
  const { notesById, profiles } = parseRelayBatch(events);
  nostrLog.debug('nostr.relay.demux.feed', {
    rawEvents: events.length,
    notes: notesById.size,
    profiles: Object.keys(profiles).length,
  });
  const itemsById = new Map<string, FeedItem>();
  for (const [id, event] of notesById) itemsById.set(id, { type: 'note', event });

  const manifest = synthesizeRecencyManifest(
    [...notesById.values()].map((e) => ({ id: e.id, created_at: e.created_at })),
  );
  const lastId = manifest.elements[manifest.elements.length - 1];
  const lastEvent = lastId ? notesById.get(lastId) : undefined;

  return {
    itemsById,
    manifest,
    stats: {},
    profiles,
    quoted: {},
    cursor: lastEvent ? { createdAt: lastEvent.created_at, id: lastEvent.id } : null,
  };
}

export function demuxRelayThread(
  events: ReadonlyArray<RawRelayEvent>,
  rootId: string,
): ThreadBundle | null {
  const { notesById, profiles } = parseRelayBatch(events);
  const root = notesById.get(rootId);
  if (!root) return null; // root not delivered → not a usable thread; fall through

  const itemsById = new Map<string, FeedItem>();
  const repliesById = new Map<string, NaggFeedEvent>();
  for (const [id, event] of notesById) {
    if (id === rootId) continue;
    itemsById.set(id, { type: 'note', event });
    repliesById.set(id, event);
  }

  const manifest = synthesizeRecencyManifest(
    [...repliesById.values()].map((e) => ({ id: e.id, created_at: e.created_at })),
  );
  const lastId = manifest.elements[manifest.elements.length - 1];
  const lastEvent = lastId ? repliesById.get(lastId) : undefined;

  return {
    root: { type: 'note', event: root },
    itemsById,
    manifest,
    stats: {},
    profiles,
    quoted: {},
    cursor: lastEvent ? { createdAt: lastEvent.created_at, id: lastEvent.id } : null,
  };
}

// ---------------------------------------------------------------------------
// Relay notifications (flat, ungrouped)
//
// The floor can't aggregate, so notifications are FLAT (grouped=false): one
// entry per reaction/repost/zap/reply that references the viewer. Fail-closed
// "references an event I own" gate — when the viewer's own event ids are known
// (the `#e`/`#q` backstop), an engagement must `#e`-reference one of them;
// otherwise we fall back to a `#p` match (the subscription already filtered #p).
// ---------------------------------------------------------------------------

export function demuxRelayNotifications(
  events: ReadonlyArray<RawRelayEvent>,
  viewerPubkey: string,
  ownEventIds?: string[],
  options?: { tab?: NotificationTab; replyScope?: NotificationReplyScope },
): NotificationsBundle {
  const own = ownEventIds && ownEventIds.length > 0 ? new Set(ownEventIds) : null;
  const tab = options?.tab ?? 'ALL';
  const replyScope = options?.replyScope ?? 'THREAD';
  const itemsById = new Map<string, NotificationItem>();
  const ordered: NaggFeedEvent[] = [];

  for (const raw of events) {
    const event = toFeedEvent(raw);
    if (!event) continue;
    const reason = classifyNotification(event, viewerPubkey, own);
    if (!reason) continue;
    // MENTIONS = replies + quotes + @-mentions (kind-1 referencing the viewer);
    // reactions/reposts/zaps are ALL-tab only.
    if (tab === 'MENTIONS' && reason !== 'reply' && reason !== 'quote' && reason !== 'mention') {
      continue;
    }
    // DIRECT scope keeps only replies whose immediate (NIP-10) parent is mine.
    if (reason === 'reply' && replyScope === 'DIRECT' && !isDirectReplyToOwn(event, own)) continue;
    if (itemsById.has(event.id)) continue;
    // Carry the referenced (target) event id so client-side grouping/dedup keys
    // these the SAME way as the nagg tier (reason + target), not by the engagement id.
    //
    // Leave `type` UNSET. The relay floor can't aggregate, so these are an
    // ungrouped transport: the app's buildNotificationListItems client-groups by
    // reason+target only when `type` is absent — a `type: 'single'` here would
    // short-circuit each engagement to its own row (grouping by the engagement
    // event instead of its target), which is exactly the bug we're avoiding.
    const targetEventId =
      reason === 'quote'
        ? (event.tags.find((t) => t[0] === 'q')?.[1] ?? event.tags.find((t) => t[0] === 'e')?.[1])
        : event.tags.find((t) => t[0] === 'e')?.[1];
    itemsById.set(event.id, {
      event,
      reason,
      actorVertexScore: 0,
      ...(targetEventId ? { targetEventId } : {}),
    });
    ordered.push(event);
  }

  const manifest = synthesizeRecencyManifest(ordered.map((e) => ({ id: e.id, created_at: e.created_at })));
  const lastId = manifest.elements[manifest.elements.length - 1];
  const lastEvent = lastId ? itemsById.get(lastId)?.event : undefined;

  return {
    itemsById,
    manifest,
    grouped: false,
    stats: {},
    profiles: {},
    quoted: {},
    cursor: lastEvent ? { createdAt: lastEvent.created_at, id: lastEvent.id } : null,
  };
}

// ---------------------------------------------------------------------------
// Relay own-history
//
// The floor fetches the viewer's own events for one action type (kind-keyed,
// authors=[me]). authored vs replies share kind 1, so they split here on the
// presence of an `e` reference (a reply marks the note it answers).
// ---------------------------------------------------------------------------

export function demuxRelayOwnHistory(
  events: ReadonlyArray<RawRelayEvent>,
  actionType: OwnActionType,
): OwnHistoryBundle {
  const own = [];
  for (const raw of events) {
    const event = toFeedEvent(raw);
    if (!event) continue;
    if (actionType === 'authored' && isReply(event.tags)) continue;
    if (actionType === 'replies' && !isReply(event.tags)) continue;
    own.push(event);
  }
  return bundleFromOwnEvents(own);
}

function isReply(tags: string[][]): boolean {
  return tags.some((t) => t[0] === 'e');
}

/**
 * Classify a raw notification event by how it references the viewer. kind-1 splits
 * into reply / quote / mention (NIP-10 / NIP-18); engagement kinds (7/6/16/9735)
 * keep their reason only when they reference one of the viewer's events. Returns
 * undefined when the event doesn't reference the viewer at all.
 */
function classifyNotification(
  event: NaggFeedEvent,
  viewerPubkey: string,
  own: Set<string> | null,
): string | undefined {
  switch (event.kind) {
    case 7:
      return referencesViewerEngagement(event, viewerPubkey, own) ? 'reaction' : undefined;
    case 6:
    case 16:
      return referencesViewerEngagement(event, viewerPubkey, own) ? 'repost' : undefined;
    case 9735:
      return referencesViewerEngagement(event, viewerPubkey, own) ? 'zap' : undefined;
    case 1:
      return classifyKind1(event, viewerPubkey, own);
    default:
      return undefined;
  }
}

function classifyKind1(
  event: NaggFeedEvent,
  viewerPubkey: string,
  own: Set<string> | null,
): 'reply' | 'quote' | 'mention' | undefined {
  const eTags = event.tags.filter((t) => t[0] === 'e').map((t) => t[1]);
  const qTags = event.tags.filter((t) => t[0] === 'q').map((t) => t[1]);
  const pMentions = event.tags.some((t) => t[0] === 'p' && t[1] === viewerPubkey);
  const refsOwnE = !!own && eTags.some((id) => own.has(id));
  const refsOwnQ = !!own && qTags.some((id) => own.has(id));
  // Quote (NIP-18 q tag) of one of my events — or, when own ids are unknown, a
  // q-tagged post that also p-tags me.
  if (qTags.length > 0 && (refsOwnQ || (!own && pMentions))) return 'quote';
  // Reply that e-references one of my events — or p-tags me within a thread.
  if (eTags.length > 0 && (refsOwnE || (!own && pMentions))) return 'reply';
  // A pure @-mention: p-tags me with no reply/quote target.
  if (pMentions && eTags.length === 0 && qTags.length === 0) return 'mention';
  // p-tags me but the reply/quote target isn't mine (an inherited thread p-tag):
  // drop it when own ids are known; treat as a mention otherwise.
  if (pMentions && !own) return 'mention';
  return undefined;
}

function referencesViewerEngagement(
  event: NaggFeedEvent,
  viewerPubkey: string,
  own: Set<string> | null,
): boolean {
  // reaction/repost/zap: fail-closed against stray inherited p-tags when we know
  // our own ids; otherwise trust the #p the subscription filtered on.
  if (own) return event.tags.some((t) => t[0] === 'e' && own.has(t[1]));
  return event.tags.some((t) => t[0] === 'p' && t[1] === viewerPubkey);
}

/** NIP-10 immediate parent: the `reply`-marked e-tag, else the last e-tag. */
function isDirectReplyToOwn(event: NaggFeedEvent, own: Set<string> | null): boolean {
  if (!own) return true; // can't refine without own ids — keep the reply
  const eTags = event.tags.filter((t) => t[0] === 'e');
  if (eTags.length === 0) return false;
  const replyMarked = eTags.find((t) => t[3] === 'reply');
  const parentId = replyMarked ? replyMarked[1] : eTags[eTags.length - 1][1];
  return !!parentId && own.has(parentId);
}

function profileFromContent(content: string | undefined): NaggProfileInfo {
  if (typeof content !== 'string') return { name: '' };
  try {
    const json = JSON.parse(content) as { name?: unknown; display_name?: unknown; picture?: unknown };
    const name =
      (typeof json.display_name === 'string' && json.display_name) ||
      (typeof json.name === 'string' && json.name) ||
      '';
    return {
      name,
      ...(typeof json.picture === 'string' ? { picture: json.picture } : {}),
    };
  } catch {
    return { name: '' };
  }
}
