import type { NaggFeedEvent, NaggProfileInfo } from '../../map/feed';
import { synthesizeRecencyManifest } from '../../tiers';
import { toFeedEvent } from '../event';
import type { FeedBundle, FeedItem } from '../feed';
import type { RawRelayEvent } from './protocol';

// ---------------------------------------------------------------------------
// Raw-relay feed demux
//
// The floor is "a bit rough but functional": relays carry notes (kind 1) and
// profiles (kind 0), but no server-side aggregate counts and no per-viewer
// overlay. So the bundle has notes + profiles, EMPTY stats (engagement is
// lazy-loaded viewport-scoped by the app, never blocking the page), NO actions
// overlay, and a synthesized recency manifest — the same contract shape every
// other tier produces, so the facade renders it identically.
// ---------------------------------------------------------------------------

const KIND_NOTE = 1;
const KIND_METADATA = 0;

export function demuxRelayFeed(events: ReadonlyArray<RawRelayEvent>): FeedBundle {
  const itemsById = new Map<string, FeedItem>();
  const eventsById = new Map<string, NaggFeedEvent>();
  const profiles: Record<string, NaggProfileInfo> = {};

  for (const raw of events) {
    if (raw.kind === KIND_NOTE) {
      const event = toFeedEvent(raw);
      if (!event || itemsById.has(event.id)) continue;
      itemsById.set(event.id, { type: 'note', event });
      eventsById.set(event.id, event);
    } else if (raw.kind === KIND_METADATA && typeof raw.pubkey === 'string') {
      profiles[raw.pubkey] = profileFromContent(raw.content);
    }
  }

  const manifest = synthesizeRecencyManifest(
    [...eventsById.values()].map((e) => ({ id: e.id, created_at: e.created_at })),
  );

  const lastId = manifest.elements[manifest.elements.length - 1];
  const lastEvent = lastId ? eventsById.get(lastId) : undefined;

  return {
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
