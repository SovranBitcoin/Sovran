// ---------------------------------------------------------------------------
// Recipient resolution — Lightning Address → Nostr pubkey
//
// Source: NIP-05 only (`/.well-known/nostr.json?name=<local>`).
//
// LNURL pay-params also carry a `nostrPubkey` field, but it is NOT the
// recipient's identity — per NIP-57:
//
//   "nostrPubkey is the nostr pubkey your server will use to sign zap
//    receipt events"
//
// Every user of a given LN-address provider shares the same `nostrPubkey`
// (the server's zap-receipt signing key). Using it would show the same
// "Pay <provider>" header for every recipient on the same domain. NIP-05
// is the only signal that maps the local-part to a per-user identity.
//
// Best-effort: any failure (timeout, non-2xx, schema mismatch, missing
// `names[<local>]` entry) returns `null`. The amount-entry screen reads
// this value cosmetically — the melt flow does not depend on it.
// ---------------------------------------------------------------------------

import { parseLightningAddress } from './lnurl';
import { logger } from './logger';
import { fetchNip05Pubkey } from './nip05';
import { type RequestControls } from './safeFetch';

/**
 * Best-effort: resolve a melt target to a recipient Nostr hex pubkey for
 * UI use only. Returns `null` for non-Lightning-Address targets (bech32
 * LNURL, BOLT-11, ecash tokens, payment requests) — those flows already
 * carry richer recipient signals through other channels.
 */
export async function resolveRecipientPubkey(
  meltTarget: string,
  controls: RequestControls = {}
): Promise<string | null> {
  if (!parseLightningAddress(meltTarget)) return null;

  const nip05 = await fetchNip05Pubkey(meltTarget, controls);
  if (nip05) {
    logger.debug('recipient.resolved.nip05');
  }
  return nip05;
}
