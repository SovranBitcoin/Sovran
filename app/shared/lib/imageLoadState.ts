import type { AvatarState } from '@/shared/ui/primitives/Avatar';

/*
 * Where a remote image stands, from the viewer's point of view:
 *
 * - unknown  — we have not yet learned whether a source exists (the kind-0
 *              or record that carries the URL is still resolving)
 * - loading  — a source is known and its bytes are on the way
 * - loaded   — painted
 * - missing  — the source is known to be absent
 * - failed   — a source existed but could not be loaded
 *
 * Placeholder policy (SYSTEM.md §7): unknown and loading show the NEUTRAL
 * placeholder (the low-contrast skeleton fill); only missing and failed show
 * the COLOUR placeholder (clay silhouette, seeded gradient, glyph). A colour
 * placeholder therefore always means "there is no image", never "we have not
 * looked yet".
 */

/**
 * Map a source URL plus whether its lookup has settled onto the Avatar's
 * three visual states. `resolved` means the metadata that would carry the
 * picture is known (cached, fetched, or the fetch gave up) — pass
 * `!isResolving` from `useNostrProfileMetadata`, `profile !== undefined` for
 * a feed profiles map, or `true` when the URL travels inside the record
 * itself (a signer app's icon, a pasted preview).
 */
export function avatarStateFor(picture: string | null | undefined, resolved: boolean): AvatarState {
  if (picture) return 'image';
  return resolved ? 'fallback' : 'loading';
}
