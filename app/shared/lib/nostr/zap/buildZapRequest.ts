/**
 * @fileoverview NIP-57 zap request (kind 9734) builder.
 *
 * A zap request is signed but NEVER published to relays — it rides the
 * LNURL invoice callback's `nostr=` query param, and the RECIPIENT's LNURL
 * server publishes the kind 9735 receipt after the invoice is paid. Do not
 * import `publishEvent` here (statically enforced by buildZapRequest.test.ts).
 *
 * Reference: https://github.com/nostr-protocol/nips/blob/master/57.md
 */

import { bech32 } from '@scure/base';
import { finalizeEvent } from 'nostr-tools';

import { nostrLog } from '../../logger';

interface ZapRequestInput {
  /** Sender's nostr secret key (same material NostrKeysProvider hands nip17). */
  privateKey: Uint8Array;
  /** Post author's nostr pubkey (hex) — the single `p` tag. */
  recipientPubkeyHex: string;
  /** Zapped event id (hex); omit for a profile zap. */
  eventId?: string;
  /** Zapped event's kind (the `k` tag). */
  eventKind?: number;
  /** MUST equal the LNURL callback's `?amount=` param (millisats). */
  amountMsats: number;
  /** Own write relays — where the recipient's server should publish the 9735. */
  relays: string[];
  /** bech32 `lnurl1…` of the recipient's pay URL; omit if encoding failed. */
  lnurl?: string;
  /** Zap comment — becomes the 9734 content. */
  content?: string;
}

/** Cap the relays tag so the callback query string stays a sane size. */
const MAX_RELAYS = 10;

/**
 * Build + sign a NIP-57 kind-9734 zap request, returned as JSON ready for
 * the LNURL callback's `nostr=` param (URL encoding is the caller's job —
 * `URL.searchParams.set` handles it).
 */
export function buildSignedZapRequestJson(input: ZapRequestInput): string {
  const tags: string[][] = [
    // One FLAT relays tag — ["relays", url, url, ...]. Nesting the urls in
    // their own arrays is the classic NIP-57 interop bug: servers then
    // publish the 9735 nowhere.
    ['relays', ...input.relays.slice(0, MAX_RELAYS)],
    ['p', input.recipientPubkeyHex],
    ['amount', String(input.amountMsats)],
  ];
  if (input.lnurl) tags.push(['lnurl', input.lnurl]);
  if (input.eventId) tags.push(['e', input.eventId]);
  if (input.eventKind != null) tags.push(['k', String(input.eventKind)]);

  const event = finalizeEvent(
    {
      kind: 9734,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: input.content ?? '',
    },
    input.privateKey
  );
  nostrLog.debug('nostr.zap.request_built', {
    eventIdPrefix: input.eventId?.slice(0, 8) ?? null,
    recipientPrefix: input.recipientPubkeyHex.slice(0, 8),
    amountMsats: input.amountMsats,
    relayCount: Math.min(input.relays.length, MAX_RELAYS),
    hasLnurl: !!input.lnurl,
    commentLength: input.content?.length ?? 0,
  });
  return JSON.stringify(event);
}

/**
 * Encode an LNURL pay URL as a bech32 `lnurl1…` string for the 9734 `lnurl`
 * tag. The tag is optional per NIP-57, so any failure returns undefined and
 * the caller simply omits it.
 */
export function lnurlBech32(payUrl: string): string | undefined {
  if (!payUrl) return undefined;
  try {
    const bytes = new TextEncoder().encode(payUrl);
    // LNURLs routinely exceed bech32's default 90-char limit; LUD-01 uses
    // an unbounded encoding, so raise the limit well past any sane URL.
    return bech32.encode('lnurl', bech32.toWords(bytes), 2000);
  } catch {
    return undefined;
  }
}
