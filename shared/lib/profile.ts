/** Profile-metadata helpers — shared across anywhere we render a nostr
 *  identity's human-readable name. */

export interface ProfileNameFields {
  name?: string;
  displayName?: string;
  display_name?: string;
}

/**
 * `display_name → displayName → name → undefined`. Returns `undefined` when
 * the profile carries no usable name.
 *
 * @deprecated Use `resolveIdentityName` from `@/shared/lib/identity` for new
 * code — it accepts the full identity context (mint name, pubkey for
 * deterministic fallback, BLE nickname, etc.) and never returns undefined.
 * This helper remains only for the few sites that genuinely want a Nostr-
 * profile-only resolver with explicit caller-managed fallbacks.
 */
export function resolveDisplayName(profile?: ProfileNameFields): string | undefined {
  return profile?.display_name || profile?.displayName || profile?.name || undefined;
}
