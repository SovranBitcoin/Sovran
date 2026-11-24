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
 * Everything else passes through unchanged.
 *
 * Defensive by contract: expo-router documents that throwing here can crash
 * the app, so the rewrite never throws; any failure returns the path
 * unchanged.
 */

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
 * Resiliently percent-decode valid UTF-8 / ASCII percent-escape runs even when
 * an unrelated malformed `%` sequence appears elsewhere in the URL, repeating
 * up to 3 passes to catch double- or triple-encoded pairing payloads.
 */
function resilientPercentDecode(value: string): string {
  let current = value;
  for (let pass = 0; pass < 3; pass += 1) {
    if (!current.includes('%')) break;
    const next = current.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run.replace(/%[0-9a-fA-F]{2}/g, (hex) => {
          const code = Number.parseInt(hex.slice(1), 16);
          return code < 0x80 ? String.fromCharCode(code) : hex;
        });
      }
    });
    if (next === current) break;
    current = next;
  }
  return current;
}

function carriesPairingSecret(path: string): boolean {
  if (PAIRING_SCHEME_RE.test(path) || CONNECT_WITH_URI_RE.test(path)) return true;
  if (EMBEDDED_PAIRING_URI_RE.test(path)) return true;
  const decoded = resilientPercentDecode(path);
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
    return path;
  } catch {
    return path;
  }
}

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return rewriteSystemPath(path);
}
