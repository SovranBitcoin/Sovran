import { z } from 'zod';
import type { NostrCursor, NostrTier, OrderingManifest } from '@sovranbitcoin/schemas';
import type { OwnActionType } from '@sovranbitcoin/schemas';
import type { NaggFeedEvent } from '../map/feed';
import { NaggFeedEventSchema } from '../schemas';
import { synthesizeRecencyManifest } from '../tiers';
import type { RequestControls } from '../timeout';
import type { TierOutcome } from '../tiers';

// ---------------------------------------------------------------------------
// Own viewer-state surface — the three-tier resolvable (ADR-0003)
//
// "Did I like / repost / reply / zap / bookmark this; who do I follow / mute;
// what are my relays" — the user's OWN action history, paged lazily and resolved
// the SAME tiered way as everything else (superseding ADR-0002's relay-only
// seeding; the local store stays authoritative as the merge target).
//
// Each entry IS an action event (a kind-7 like, a kind-6 repost, …), so there is
// no stats/actions overlay — the events themselves are the viewer-state. Per the
// matrix: nagg covers every type; Primal lacks my-likes / my-reposts (those fall
// through to the floor); the relay floor covers the author-keyed kinds but not
// zaps-sent (a zap receipt isn't authored by the sender).
// ---------------------------------------------------------------------------

export type OwnHistoryRequest = RequestControls & {
  actionType: OwnActionType;
  viewerPubkey: string;
  cursor?: NostrCursor;
  limit?: number;
  refresh?: boolean;
};

export type OwnHistoryEntry = NaggFeedEvent;

export type OwnHistoryBundle = {
  itemsById: Map<string, OwnHistoryEntry>;
  manifest: OrderingManifest;
  cursor: NostrCursor;
};

export type ResolvedOwnHistory = {
  tier: NostrTier;
  actionType: OwnActionType;
  entries: OwnHistoryEntry[];
  cursor: NostrCursor;
  missingIds: string[];
};

export interface OwnHistoryTier {
  readonly tier: NostrTier;
  ownHistory(request: OwnHistoryRequest): Promise<TierOutcome<OwnHistoryBundle>>;
}

/**
 * The nagg own-events endpoint response shape (`/nostr/own/{type}`). This pins
 * the contract PR-2 implements: a paginated list of the viewer's own events for
 * one action type, cursor = the oldest event's created_at.
 */
export const OwnHistoryResponseSchema = z.object({
  events: z.array(NaggFeedEventSchema),
  paginationUntil: z.number().optional(),
});

/** The Nostr kinds backing each action type (used by the relay floor's filters). */
export function ownActionKinds(actionType: OwnActionType): number[] {
  switch (actionType) {
    case 'authored':
    case 'replies':
      return [1, 1111];
    case 'likes':
      return [7];
    case 'reposts':
      return [6, 16];
    case 'bookmarks':
      return [10003];
    case 'follows':
      return [3];
    case 'mutes':
      return [10000];
    case 'relays':
      return [10002];
    case 'zaps-sent':
      return [9735];
  }
}

/** Chronological (newest-first) bundle from a flat list of the viewer's own events. */
export function bundleFromOwnEvents(events: ReadonlyArray<NaggFeedEvent>): OwnHistoryBundle {
  const itemsById = new Map<string, OwnHistoryEntry>();
  for (const event of events) {
    if (!itemsById.has(event.id)) itemsById.set(event.id, event);
  }
  const manifest = synthesizeRecencyManifest(
    [...itemsById.values()].map((e) => ({ id: e.id, created_at: e.created_at })),
  );
  const lastId = manifest.elements[manifest.elements.length - 1];
  const lastEvent = lastId ? itemsById.get(lastId) : undefined;
  return {
    itemsById,
    manifest,
    cursor: lastEvent ? { createdAt: lastEvent.created_at, id: lastEvent.id } : null,
  };
}
