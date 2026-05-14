// ---------------------------------------------------------------------------
// NIP-05 resolution — lightning address → Nostr hex pubkey
//
// When a payment target is a Lightning Address (`<name>@<domain>`), the
// recipient often publishes a Nostr identity at the same well-known path.
// Fetching that lets the wallet show the recipient's avatar + display name
// on the amount-entry screen instead of an anonymous mint pill.
//
// Spec: https://github.com/nostr-protocol/nips/blob/master/05.md
//   • GET `https://<domain>/.well-known/nostr.json?name=<local>`
//   • Body: `{ names: { <local>: <hex_pubkey> }, relays?: { <hex>: string[] } }`
//   • Pubkey is 32-byte lowercase hex (64 chars).
//
// Hardening mirrors `lnurl.ts`:
//   • timeouts via `safeFetch`,
//   • `.onion` short-circuit so the OS resolver doesn't stall the flow,
//   • silent fallback to `null` on anything but a clean success — this is a
//     cosmetic enrichment, never a melt blocker.
// ---------------------------------------------------------------------------

import { z } from 'zod';

import { errField, logger } from './logger';
import { parseLightningAddress } from './lnurl';
import { isAbortError, safeFetch, type RequestControls } from './safeFetch';

const HEX_PUBKEY = /^[0-9a-f]{64}$/;

/**
 * Minimal NIP-05 response shape. `relays` is documented by the spec but
 * unused by the recipient-header flow, so it is accepted-but-ignored to
 * keep the schema strict enough to reject obvious junk.
 */
const Nip05Response = z.looseObject({
  names: z.record(z.string(), z.string()),
});

function isOnionHost(host: string): boolean {
  return host.toLowerCase().endsWith('.onion');
}

/**
 * Resolve a Lightning Address to a Nostr hex pubkey via NIP-05.
 *
 * Returns `null` on:
 *   • input that is not a Lightning Address,
 *   • `.onion` domain (RN/iOS/Android can't resolve at OS level),
 *   • network failure, non-2xx response, malformed JSON,
 *   • schema mismatch,
 *   • missing entry for the requested name,
 *   • a `names[<name>]` value that is not 32-byte lowercase hex.
 *
 * Lookup is case-insensitive against the `names` map: the spec lowercases
 * the local-part, but a non-trivial number of providers ship mixed-case
 * keys (`Alice`, `_Root`). Probing both forms costs nothing and avoids a
 * missed match.
 */
export async function fetchNip05Pubkey(
  address: string,
  controls: RequestControls = {}
): Promise<string | null> {
  const parsed = parseLightningAddress(address);
  if (!parsed) return null;
  const { username, domain } = parsed;
  if (isOnionHost(domain)) return null;

  const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(username)}`;

  let response: Response;
  try {
    response = await safeFetch(url, controls);
  } catch (e) {
    if (isAbortError(e)) return null;
    logger.warn('nip05.fetchFailed', { error: errField(e) });
    return null;
  }
  if (!response.ok) {
    logger.warn('nip05.httpError', { status: response.status });
    return null;
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (e) {
    logger.warn('nip05.invalidJson', { error: errField(e) });
    return null;
  }

  const result = Nip05Response.safeParse(raw);
  if (!result.success) {
    logger.warn('nip05.invalidShape');
    return null;
  }

  const names = result.data.names;
  const hex = names[username] ?? names[username.toLowerCase()] ?? null;
  if (!hex) return null;

  const lower = hex.toLowerCase();
  if (!HEX_PUBKEY.test(lower)) {
    logger.warn('nip05.invalidHex');
    return null;
  }
  return lower;
}
