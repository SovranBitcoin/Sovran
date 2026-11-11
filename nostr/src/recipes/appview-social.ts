// REST app-view bindings for the enrich / batch-profile lookups. Each returns a
// `NaggAppViewBinding` the client/facade hands to `client.rest`; the routes answer
// with the v2 generic envelope (parse with `NaggEnvelopeSchema`, reconstruct with
// `enrichmentFromEnvelope` in `src/envelope.ts`).

import type { NaggAppViewBinding } from '../transport';

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
