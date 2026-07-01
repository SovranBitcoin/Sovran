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

function loggableAddress(address: string): Record<string, unknown> {
  const parsed = parseLightningAddress(address);
  return {
    inputLength: address.length,
    parsed: !!parsed,
    usernameLength: parsed?.username.length ?? 0,
    domain: parsed?.domain ?? null,
  };
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
  controls: RequestControls = {},
): Promise<string | null> {
  logger.info('nip05.resolve.start', {
    ...loggableAddress(address),
    hasSignal: !!controls.signal,
    signalAborted: controls.signal?.aborted === true,
    timeoutMs: controls.timeoutMs ?? null,
  });
  const parsed = parseLightningAddress(address);
  if (!parsed) {
    logger.debug('nip05.resolve.skipped', {
      reason: 'not_lightning_address',
      inputLength: address.length,
    });
    return null;
  }
  const { username, domain } = parsed;
  if (isOnionHost(domain)) {
    logger.info('nip05.resolve.skipped', {
      reason: 'onion_host',
      domain,
      usernameLength: username.length,
    });
    return null;
  }

  const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(username)}`;

  let response: Response;
  try {
    logger.debug('nip05.fetch.start', {
      domain,
      usernameLength: username.length,
    });
    response = await safeFetch(url, controls);
  } catch (e) {
    if (isAbortError(e)) {
      logger.warn('nip05.fetch.timeout', {
        domain,
        usernameLength: username.length,
      });
      return null;
    }
    logger.warn('nip05.fetchFailed', {
      domain,
      usernameLength: username.length,
      error: errField(e),
    });
    return null;
  }
  if (!response.ok) {
    logger.warn('nip05.httpError', {
      domain,
      usernameLength: username.length,
      status: response.status,
    });
    return null;
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (e) {
    logger.warn('nip05.invalidJson', {
      domain,
      usernameLength: username.length,
      error: errField(e),
    });
    return null;
  }

  const result = Nip05Response.safeParse(raw);
  if (!result.success) {
    logger.warn('nip05.invalidShape', {
      domain,
      usernameLength: username.length,
      issueCount: result.error.issues.length,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
      })),
    });
    return null;
  }

  const names = result.data.names;
  const hex = names[username] ?? names[username.toLowerCase()] ?? null;
  if (!hex) {
    logger.info('nip05.resolve.empty', {
      domain,
      usernameLength: username.length,
      namesCount: Object.keys(names).length,
    });
    return null;
  }

  const lower = hex.toLowerCase();
  if (!HEX_PUBKEY.test(lower)) {
    logger.warn('nip05.invalidHex', {
      domain,
      usernameLength: username.length,
      pubkeyLength: hex.length,
    });
    return null;
  }
  logger.info('nip05.resolve.done', {
    domain,
    usernameLength: username.length,
    pubkeyLength: lower.length,
  });
  return lower;
}
