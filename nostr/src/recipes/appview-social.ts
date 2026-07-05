// REST app-view bindings for the social reads: enrich / batch-profile lookups,
// the constrained filtered-events query (Whitenoise + wallpaper catalog +
// recent posts-by-pubkeys), follow-status, own-profiles, the notifications-seen
// marker, and the scoped DM conversation. Each returns a `NaggAppViewBinding`
// the client/facade hands to `client.rest`. Every route answers with the v2
// generic envelope — parse with `NaggEnvelopeSchema` (or the route's extension,
// e.g. `NaggFollowStatusEnvelopeSchema`) and reconstruct via `src/envelope.ts`
// (`enrichmentFromEnvelope`, `followStatusRowsFromEnvelope`,
// `ownProfilesFromEnvelope`, `seenUntilFromEnvelope`, …).

import type { NaggAppViewBinding, NaggSearchParams } from '../transport';
import type { EventQueryInput } from './rank';

// ---------------------------------------------------------------------------
// Enrich / batch profiles
// ---------------------------------------------------------------------------

/** GET `/nostr/events?ids=…` — enrich/quoted events by id. */
export function eventsAppView(ids: readonly string[]): NaggAppViewBinding {
  return {
    path: '/nostr/events',
    method: 'GET',
    operationName: 'Events',
    searchParams: { ids: ids.filter((id) => id.length > 0).join(',') },
  };
}

/** GET `/nostr/profiles?pubkeys=…` — batch kind-0 profile events + pubkey aggregates. */
export function profilesAppView(pubkeys: readonly string[]): NaggAppViewBinding {
  return {
    path: '/nostr/profiles',
    method: 'GET',
    operationName: 'Profiles',
    searchParams: { pubkeys: pubkeys.filter((p) => p.length > 0).join(',') },
  };
}

// ---------------------------------------------------------------------------
// Filtered events query — POST /nostr/events/query
// ---------------------------------------------------------------------------

/**
 * POST `/nostr/events/query` — the constrained filtered-event read backing the
 * niche paths (Whitenoise group msgs/invites, wallpaper catalog, recent
 * posts-by-pubkeys). Adapts the recipe `EventQueryInput` to the endpoint's
 * bounded filter body. Returns `{ events: { nodes, pageInfo } }`.
 */
export function eventsQueryAppView(input: EventQueryInput): NaggAppViewBinding {
  return {
    path: '/nostr/events/query',
    method: 'POST',
    operationName: 'EventsQuery',
    body: eventsQueryBody(input),
  };
}

function eventsQueryBody(input: EventQueryInput): Record<string, unknown> {
  const tags = (input.tags ?? [])
    .map((t) => ({
      key: t.key,
      values: t.values ?? (t.value !== undefined ? [t.value] : []),
    }))
    .filter((t) => t.key && t.values.length > 0);
  return {
    ...(input.ids && input.ids.length > 0 ? { ids: input.ids } : {}),
    ...(input.pubkeys && input.pubkeys.length > 0 ? { authors: input.pubkeys } : {}),
    ...(input.kinds && input.kinds.length > 0 ? { kinds: input.kinds } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(input.since ? { since: input.since } : {}),
    ...(input.until ? { until: input.until } : {}),
    limit: input.limit ?? 200,
  };
}

// ---------------------------------------------------------------------------
// Follow status — GET /nostr/follow-status
// ---------------------------------------------------------------------------

export function followStatusAppView(input: { viewer: string; candidates: readonly string[] }): NaggAppViewBinding {
  return {
    path: '/nostr/follow-status',
    method: 'GET',
    operationName: 'FollowStatus',
    searchParams: {
      viewer: input.viewer,
      candidates: input.candidates.slice(0, 500).join(','),
    } satisfies NaggSearchParams,
  };
}

// ---------------------------------------------------------------------------
// Own profiles — GET /nostr/own/profiles
// ---------------------------------------------------------------------------

export function ownProfilesAppView(pubkeys: readonly string[]): NaggAppViewBinding {
  return {
    path: '/nostr/own/profiles',
    method: 'GET',
    operationName: 'OwnProfiles',
    searchParams: { pubkeys: pubkeys.slice(0, 10).join(',') },
  };
}

// ---------------------------------------------------------------------------
// Notifications seen marker — GET /nostr/notifications/seen
// ---------------------------------------------------------------------------

/**
 * GET `/nostr/notifications/seen` — returns an envelope carrying the viewer's
 * kind-30078 seen marker event; parse the watermark with `seenUntilFromEnvelope`.
 */
export function notificationsSeenAppView(pubkey: string): NaggAppViewBinding {
  return {
    path: '/nostr/notifications/seen',
    method: 'GET',
    operationName: 'NotificationsSeen',
    searchParams: { pubkey },
  };
}

// ---------------------------------------------------------------------------
// Scoped DM conversation — GET /nostr/dm/conversation
// ---------------------------------------------------------------------------

export function dmConversationAppView(input: {
  viewer: string;
  counterparty?: string;
  kinds?: number[];
  until?: number;
  limit?: number;
}): NaggAppViewBinding {
  const kinds = input.kinds ?? [4, 1059];
  return {
    path: '/nostr/dm/conversation',
    method: 'GET',
    operationName: 'DmConversation',
    searchParams: {
      viewer: input.viewer,
      ...(input.counterparty ? { counterparty: input.counterparty } : {}),
      kinds: kinds.join(','),
      ...(input.until ? { until: input.until } : {}),
      limit: input.limit ?? 50,
    },
  };
}
