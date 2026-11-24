/**
 * @fileoverview expo-router native intent: drop Remote Login pairing links.
 *
 * Remote Login (NIP-46) was removed (ADR 0035) and the app no longer claims
 * the `nostrconnect` scheme, but a link can still arrive: an install that has
 * not picked up the new scheme list, or a `sovran://…/connect?uri=` link an
 * older build produced. Such a link carries a pairing bearer secret, so it is
 * sent to the wallet (`/`) before the router can put it in navigation state.
 * Everything else passes through unchanged.
 *
 * Defensive by contract: expo-router documents that throwing here can crash
 * the app, so the rewrite never throws; any failure returns the path
 * unchanged.
 */

const NOSTRCONNECT_SCHEME_RE = /^nostrconnect:\/\//i;
/** A link naming the old connect route and carrying a pairing link as a param. */
const CONNECT_WITH_URI_RE = /\/connect\/?\?(?:[^#]*&)?uri=/i;

/** Exported for direct unit coverage. */
export function rewriteSystemPath(path: string): string {
  try {
    if (typeof path !== 'string') return path;
    if (NOSTRCONNECT_SCHEME_RE.test(path) || CONNECT_WITH_URI_RE.test(path)) return '/';
    return path;
  } catch {
    return path;
  }
}

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return rewriteSystemPath(path);
}
