/**
 * @fileoverview expo-router native intent: rewrite links to removed routes.
 *
 * Remote Login (NIP-46) was removed (ADR 0035) and the app no longer claims
 * the `nostrconnect` scheme, but a link can still arrive: an install that has
 * not picked up the new scheme list, or a `sovran://…/connect?uri=` link an
 * older build produced. Such a link carries a pairing bearer secret, so it is
 * sent to the wallet (`/`) before the router can put it in navigation state.
 *
 * The Contacts tab was removed in the same change; a `sovran://contacts` link
 * (or any `/contacts…` path) opens the Search tab instead of +not-found.
 *
 * Seven route groups were flattened onto the root (`(map-flow)`,
 * `(theme-flow)`, `(filter-flow)`, `(transactions-flow)`, `(user-flow)`,
 * `(profile-flow)`, `(prompt-flow)`): a link naming one opens the same page at
 * its root path, with its query and fragment unchanged. Only those seven are
 * rewritten; the four flow groups that remain resolve as before.
 * Everything else passes through unchanged.
 *
 * Defensive by contract: expo-router documents that throwing here can crash
 * the app, so the rewrite never throws; any failure returns the path
 * unchanged.
 */

import { percentDecodeFully } from '@/shared/lib/percentDecode';

const PAIRING_SCHEME_RE = /^(?:nostrconnect|bunker):\/\//i;
/** Any decoded query/fragment carrying a NIP-46 pairing URI payload. */
const EMBEDDED_PAIRING_URI_RE = /(?:^|[?&=#/])(?:nostrconnect|bunker):\/\//i;
/** A link naming the old connect route and carrying a pairing link as a param. */
const CONNECT_WITH_URI_RE = /\/connect\/?\?(?:[^#]*&)?uri=/i;
/**
 * The old Contacts tab: `sovran://contacts`, `/contacts`, a web link's
 * `https://host/contacts`, or the grouped `/(drawer)/(tabs)/contacts`, with any
 * sub-path or query. Not `contactsfoo`.
 */
const CONTACTS_ROUTE_RE =
  /^(?:[a-z][a-z0-9+.-]*:\/\/(?:[^/?#]*\/)?)?\/?(?:\((?:drawer|tabs)\)\/)*contacts(?:[/?#].*)?$/i;

/**
 * A link into a flattened group: an optional `scheme://` (and host), the
 * group, then its leaf path and the query or fragment, kept verbatim.
 */
const LEGACY_GROUP_RE =
  /^(?:[a-z][a-z0-9+.-]*:\/\/(?:[^/?#]*\/)?)?\/?\((filter|map|theme|user|profile|prompt|transactions)-flow\)(\/[^?#]*)?([?#].*)?$/i;

/**
 * Both removed `(user-flow)/share` and `(profile-flow)/share` wrappers
 * defaulted `type` to `npub`, whereas the root `/share` screen defaults to
 * `profile` (which omits the Lightning tab). Preserve the `npub` default when
 * a legacy share link omits `type`.
 */
function withDefaultShareType(tail: string): string {
  const hashAt = tail.indexOf('#');
  const query = hashAt === -1 ? tail : tail.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : tail.slice(hashAt);
  if (/(?:^\?|&)type=/i.test(query)) return tail;
  const nextQuery = query === '' || query === '?' ? '?type=npub' : `${query}&type=npub`;
  return `${nextQuery}${hash}`;
}

/** The root path for a link into a flattened group, or null when it names none. */
function rewriteLegacyGroup(path: string): string | null {
  const match = LEGACY_GROUP_RE.exec(path);
  if (!match) return null;
  const [, group, leaf = '', tail = ''] = match;
  const bare = leaf === '' || leaf === '/';
  const lowerGroup = group.toLowerCase();
  // The map group's index page is the map; no other group had one.
  if (lowerGroup === 'map' && (bare || /^\/index\/?$/i.test(leaf))) return `/map${tail}`;
  if (bare) return null;
  if ((lowerGroup === 'user' || lowerGroup === 'profile') && /^\/share\/?$/i.test(leaf)) {
    return `${leaf}${withDefaultShareType(tail)}`;
  }
  return `${leaf}${tail}`;
}

function carriesPairingSecret(path: string): boolean {
  if (PAIRING_SCHEME_RE.test(path) || CONNECT_WITH_URI_RE.test(path)) return true;
  if (EMBEDDED_PAIRING_URI_RE.test(path)) return true;
  const { decoded, settled } = percentDecodeFully(path);
  // Encoded deeper than the decoder follows: nothing here needs that, so it
  // is treated as hiding a pairing link.
  if (!settled) return true;
  if (decoded !== path) {
    if (
      PAIRING_SCHEME_RE.test(decoded) ||
      CONNECT_WITH_URI_RE.test(decoded) ||
      EMBEDDED_PAIRING_URI_RE.test(decoded)
    ) {
      return true;
    }
  }
  return false;
}

/** Exported for direct unit coverage. */
export function rewriteSystemPath(path: string): string {
  try {
    if (typeof path !== 'string') return path;
    if (carriesPairingSecret(path)) return '/';
    if (CONTACTS_ROUTE_RE.test(path)) return '/search';
    return rewriteLegacyGroup(path) ?? path;
  } catch {
    return path;
  }
}

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return rewriteSystemPath(path);
}
