/**
 * @fileoverview expo-router native intent — nostrconnect:// rewrite
 *
 * System URLs with the `nostrconnect` scheme carry the entire NIP-46 pairing
 * payload in the URL itself (there is no path to route), so the URL is held
 * in memory and the app is sent to the signer deep-link target with a ticket
 * for it. The target redeems the ticket and opens the 'signer-connect' sheet.
 * Everything else passes through unchanged.
 *
 * Defensive by contract: expo-router documents that throwing here can crash
 * the app, so the rewrite never throws — any failure returns the path
 * unchanged. The URL embeds a pairing bearer secret — never log it and never
 * put it in a route param.
 */

import { holdPairingUri } from '@/features/nostrSigner/lib/pendingPairingUri';

const NOSTRCONNECT_SCHEME_RE = /^nostrconnect:\/\//i;

/** Exported for direct unit coverage. */
export function rewriteSystemPath(path: string): string {
  try {
    if (typeof path !== 'string' || !NOSTRCONNECT_SCHEME_RE.test(path)) return path;
    return '/(signer-flow)/connect?ticket=' + holdPairingUri(path);
  } catch {
    return path;
  }
}

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return rewriteSystemPath(path);
}
