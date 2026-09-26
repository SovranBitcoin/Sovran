import { facade, type NaggIdentity } from 'nostr';

import { peekNostrDataLayer } from '@/shared/lib/nostr/dataLayerRegistry';

/**
 * nagg's `identities` map from any route that carried one, written to the
 * single owner. Called by the app-side fetchers (profile, discovery, mint
 * info, the AI provider directory) right after the parse, so the six ways
 * those routes used to spell an operator all land in one cache entry.
 *
 * Peeks rather than builds: the API client is imported by half the app and
 * must not drag the data layer's dependency graph behind it. A fetch that
 * lands before any layer exists has nowhere to write, and the same route
 * answers again the next time it is asked.
 */
export function cacheIdentities(
  identities: Readonly<Record<string, NaggIdentity>> | undefined
): void {
  if (!identities || Object.keys(identities).length === 0) return;
  const cache = peekNostrDataLayer()?.cache;
  if (!cache) return;
  facade.ingestIdentities(cache, identities, 'nagg');
}
