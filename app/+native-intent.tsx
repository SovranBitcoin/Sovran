/**
 * @fileoverview expo-router native intent — nostrconnect:// rewrite
 *
 * System URLs with the `nostrconnect` scheme carry the entire NIP-46 pairing
 * payload in the URL itself (there is no path to route), so they are
 * rewritten to the signer deep-link target, which re-validates the `uri`
 * param at the route boundary and opens the 'signer-connect' sheet.
 * Everything else passes through unchanged.
 *
 * Defensive by contract: expo-router documents that throwing here can crash
 * the app, so the rewrite never throws — any failure returns the path
 * unchanged. The URL embeds a pairing bearer secret — never log it.
 */

const NOSTRCONNECT_SCHEME_RE = /^nostrconnect:\/\//i;

/** Pure rewrite, exported for direct unit coverage. */
export function rewriteSystemPath(path: string): string {
  try {
    if (typeof path !== 'string' || !NOSTRCONNECT_SCHEME_RE.test(path)) return path;
    return '/(signer-flow)/connect?uri=' + encodeURIComponent(path);
  } catch {
    return path;
  }
}

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return rewriteSystemPath(path);
}
