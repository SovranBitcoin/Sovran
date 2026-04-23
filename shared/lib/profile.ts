/** Profile-metadata helpers — shared across anywhere we render a nostr
 *  identity's human-readable name. */

export interface ProfileNameFields {
  name?: string;
  displayName?: string;
  display_name?: string;
}

/** `display_name → displayName → name → undefined`. NIP-01 metadata uses both
 *  snake_case (historical) and camelCase (current REST + relay enrichment),
 *  so callers should pass either shape through unchanged. Returns
 *  `undefined` when the profile carries no usable name — the caller then
 *  falls back to a pubkey-abbreviation via its own `titleFallback`. */
export function resolveDisplayName(profile?: ProfileNameFields): string | undefined {
  return profile?.display_name || profile?.displayName || profile?.name || undefined;
}
