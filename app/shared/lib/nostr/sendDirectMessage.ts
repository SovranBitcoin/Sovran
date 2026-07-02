/**
 * @fileoverview Sovran-side NIP-17 direct-message publisher.
 *
 * Decodes an nprofile, builds a kind-1059 gift wrap via `buildRecipientGiftWrap`
 * (no sender self-copy — payment-request DMs don't need one), and publishes
 * through nostr-tools' `SimplePool`. Resolves once the first relay accepts;
 * rejects once every relay rejects, or with a `TimeoutError` if no relay
 * accepts within `timeoutMs`.
 *
 * Real-world relay availability is poor: public relays regularly stall on
 * publish under load. nostr-tools'
 * per-relay promises may never settle when the socket stalls (no heartbeat),
 * and `Promise.any` only rejects when every relay rejects, so a fully-stalled
 * relay set leaves the caller's await hanging until TCP eventually fails. We
 * bound the publish with `withTimeout` so the caller always gets a definite
 * answer.
 */

import { nip19, SimplePool } from 'nostr-tools';

import { withTimeout } from 'wallet';

import { nostrLog } from '@/shared/lib/logger';

import { buildRecipientGiftWrap } from './nip17';

const DEFAULT_PAYMENT_RELAY = 'wss://relay.vertexlab.io';

const FALLBACK_PAYMENT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.8333.space/',
  'wss://nos.lol',
  'wss://relay.nostr.band',
];

/** Publish/advertise relay set for payment DMs — also embedded as the relay
 *  hints in NUT-18 nostr-transport nprofiles. */
export const PAYMENT_RELAYS = [DEFAULT_PAYMENT_RELAY, ...FALLBACK_PAYMENT_RELAYS];

/** How long to wait for the first relay OK before failing the publish. */
const DEFAULT_PUBLISH_TIMEOUT_MS = 15_000;

export async function sendDirectMessageToRelays(params: {
  senderPrivateKey: Uint8Array;
  nprofile: string;
  message: string;
  timeoutMs?: number;
}): Promise<void> {
  const decoded = nip19.decode(params.nprofile);
  if (decoded.type !== 'nprofile') {
    nostrLog.warn('nostr.sendDirectMessage.invalidNprofile', {
      decodedType: decoded.type,
      inputPreview: params.nprofile.slice(0, 30),
    });
    throw new Error('Invalid nprofile format');
  }

  const { pubkey, relays } = decoded.data;
  nostrLog.info('nostr.sendDirectMessage.publish', {
    pubkeyPreview: pubkey.slice(0, 12) + '…',
    relayCount: relays?.length ?? 0,
    usingDefaults: !relays?.length,
  });
  const relayUrls =
    relays?.length && relays.length > 0
      ? relays
      : [DEFAULT_PAYMENT_RELAY, ...FALLBACK_PAYMENT_RELAYS];
  const uniqueRelays = [...new Set(relayUrls)];

  const { recipientWrap } = buildRecipientGiftWrap({
    content: params.message,
    senderPrivateKey: params.senderPrivateKey,
    recipientPublicKey: pubkey,
  });

  const pool = new SimplePool();
  try {
    await withTimeout(
      Promise.any(pool.publish(uniqueRelays, recipientWrap)),
      params.timeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS,
      'sendDirectMessage publish'
    );
    nostrLog.info('nostr.sendDirectMessage.published');
  } finally {
    pool.close(uniqueRelays);
  }
}
