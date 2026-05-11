import { getUsername } from './username';
import type { ProfileNameFields } from './profile';

/**
 * Inputs to {@link resolveIdentityName}. Callers pass whatever data they
 * already have — none of these are required, but at least one of `pubkey`,
 * `nostrProfile`, `mintName`, `bleNickname`, or `overrideName` should be
 * provided to get a meaningful name.
 */
export interface IdentityNameInputs {
  /**
   * Hex pubkey (Nostr) or any stable hex-string identifier. When set,
   * powers the deterministic word-pair fallback (`getUsername`) so a
   * caller is never stuck with an empty string. The same input always
   * produces the same word pair, drawer-style.
   */
  pubkey?: string | null;

  /**
   * Already-resolved Nostr metadata, typically read from
   * `useNostrProfileMetadata` / `useNostrProfileMetadataMany` /
   * `nostrMetadataCache`. The resolver consults `displayName` then `name`
   * — NIP-05 is intentionally NOT used as a name fallback (it's a
   * verification pill, not an identity).
   */
  nostrProfile?: ProfileNameFields | null;

  /**
   * Mint display name from NUT-06 / NIP-87 mint info. When present this
   * wins over the Nostr metadata — a mint's branded name is more useful
   * to the user than the operator's personal Nostr display name.
   */
  mintName?: string | null;

  /**
   * BLE / BitChat advertised nickname. Only consulted when there is no
   * Nostr / mint identity. For pure-BLE peers (no Nostr pubkey known)
   * this is what shows up in the row.
   */
  bleNickname?: string | null;

  /**
   * Caller-supplied override that beats every other source. Use for
   * pinned nicknames stored separately from Nostr metadata, or any
   * label the caller has authoritatively chosen.
   */
  overrideName?: string | null;

  /**
   * Semantic fallback that wins ONLY over `'Unknown'`. Use when a
   * transport has a meaningful default label that's better than a
   * deterministic word pair *if no other identity exists*. Example: the
   * Routstr AI session uses `fallbackName: 'routstr'` and omits
   * `pubkey`, so an empty Nostr profile renders as "routstr" instead of
   * "Unknown". If `pubkey` is provided, the deterministic word pair wins
   * over this — semantic labels are last-resort.
   */
  fallbackName?: string | null;
}

/**
 * Resolve a single human-readable identity name from whatever data the
 * caller has on hand. The hierarchy, highest priority first:
 *
 *   1. `overrideName`
 *   2. `mintName`
 *   3. `nostrProfile.displayName` (or `display_name`)
 *   4. `nostrProfile.name`
 *   5. `bleNickname`
 *   6. `getUsername(pubkey)` — deterministic word pair, drawer-style
 *   7. `fallbackName` — semantic last-resort label
 *   8. `'Unknown'`
 *
 * Always returns a non-empty string. Pure / synchronous — the caller is
 * responsible for managing the metadata cache (typically via
 * `useIdentityName` / `useIdentityNames` which wrap this with the SWR
 * Nostr metadata layer).
 */
export function resolveIdentityName(input: IdentityNameInputs): string {
  if (input.overrideName?.trim()) return input.overrideName.trim();
  if (input.mintName?.trim()) return input.mintName.trim();
  const nostrDisplay =
    input.nostrProfile?.display_name?.trim() || input.nostrProfile?.displayName?.trim();
  if (nostrDisplay) return nostrDisplay;
  const nostrName = input.nostrProfile?.name?.trim();
  if (nostrName) return nostrName;
  if (input.bleNickname?.trim()) return input.bleNickname.trim();
  if (input.pubkey) return getUsername(input.pubkey);
  if (input.fallbackName?.trim()) return input.fallbackName.trim();
  return 'Unknown';
}
