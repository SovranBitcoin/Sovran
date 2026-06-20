import type { NaggFeedEvent, NaggProfileInfo } from '../../map/feed';
import { synthesizeRecencyManifest } from '../../tiers';
import { toFeedEvent } from '../event';
import type { FeedBundle, FeedItem } from '../feed';
import type { ThreadBundle } from '../thread';
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
