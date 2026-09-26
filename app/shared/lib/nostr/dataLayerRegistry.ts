import type { facade } from 'nostr';

// ---------------------------------------------------------------------------
// The built data layer, readable without importing what builds it.
//
// `buildNostrDataLayer` pulls in the tier config, the profile store, the
// logger bridge and persistence. A module that only wants to WRITE a figure
// into the cache when a layer exists (the API client after a parse, a list
// row reading a reputation) must not drag that graph — and everything a Jest
// suite would have to mock — behind it. The builder registers here; readers
// peek here.
// ---------------------------------------------------------------------------

let current: facade.NostrDataLayer | null = null;

/** Called by the builder whenever the singleton is (re)built or torn down. */
export function registerNostrDataLayer(layer: facade.NostrDataLayer | null): void {
  current = layer;
}

/**
 * The data layer if one has been built, without building one. A render path
 * or a write-through that runs before the layer exists has nothing to read
 * or nowhere to write, and neither should resolve tier config to find out.
 */
export function peekNostrDataLayer(): facade.NostrDataLayer | null {
  return current;
}
