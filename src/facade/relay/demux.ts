import type { NaggFeedEvent, NaggProfileInfo } from '../../map/feed';
import { synthesizeRecencyManifest } from '../../tiers';
import { toFeedEvent } from '../event';
import type { FeedBundle, FeedItem } from '../feed';
import type { ThreadBundle } from '../thread';
import type { NotificationItem, NotificationsBundle } from '../notifications';
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

function parseRelayBatch(events: ReadonlyArray<RawRelayEvent>): RelayBatch {
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
): NotificationsBundle {
  const own = ownEventIds && ownEventIds.length > 0 ? new Set(ownEventIds) : null;
  const itemsById = new Map<string, NotificationItem>();
  const ordered: NaggFeedEvent[] = [];

  for (const raw of events) {
    const event = toFeedEvent(raw);
    if (!event) continue;
    const reason = reasonForKind(event.kind);
    if (!reason) continue;
    if (!referencesViewer(event, viewerPubkey, own, reason)) continue;
    if (itemsById.has(event.id)) continue;
    itemsById.set(event.id, { type: 'single', event, reason, actorVertexScore: 0 });
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

function reasonForKind(kind: number): string | undefined {
  switch (kind) {
    case 7:
      return 'reaction';
    case 6:
    case 16:
      return 'repost';
    case 9735:
      return 'zap';
    case 1:
      return 'reply';
    default:
      return undefined;
  }
}

function referencesViewer(
  event: NaggFeedEvent,
  viewerPubkey: string,
  own: Set<string> | null,
  reason: string,
): boolean {
  const eTags = event.tags.filter((t) => t[0] === 'e').map((t) => t[1]);
  const pTags = event.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
  if (reason === 'reply') {
    // replies often omit #p — include if they p-tag me OR e-reference one of my events
    return pTags.includes(viewerPubkey) || (!!own && eTags.some((id) => own.has(id)));
  }
  // reaction/repost/zap: fail-closed against stray inherited p-tags when we know
  // our own ids; otherwise trust the #p the subscription filtered on.
  if (own) return eTags.some((id) => own.has(id));
  return pTags.includes(viewerPubkey);
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
