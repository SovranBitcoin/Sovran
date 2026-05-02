/**
 * @fileoverview Pure TS operation for sending NIP-17 direct messages
 *
 * Uses nostr-tools (SimplePool, nip19, buildGiftWrappedDM) instead of NDK.
 * No React hooks or NDK dependency — works as an injectable operation.
 *
 * Real-world relay availability is poor: relay.damus.io, nos.lol, and
 * relay.primal.net all regularly stall on publish under load. nostr-tools
 * `pool.publish` returns per-relay promises that may never settle when the
 * socket stalls (no heartbeat). `Promise.any` only rejects when every
 * relay rejects, so a fully-stalled relay set leaves the caller's await
 * hanging until TCP eventually fails — minutes, sometimes never. We bound
 * the publish with `withTimeout` so the machine's `sendLocked` flow always
 * gets a definite answer.
 */

import { nip19, SimplePool } from 'nostr-tools';

import { withTimeout } from '../safeFetch';
import { buildGiftWrappedDM } from './nip17';

const DEFAULT_PAYMENT_RELAY = 'wss://relay.vertexlab.io';

const FALLBACK_PAYMENT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.8333.space/',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

/** How long to wait for the first relay OK before failing the publish. */
const DEFAULT_PUBLISH_TIMEOUT_MS = 15_000;

/**
 * Send a NIP-17 gift-wrapped direct message to an nprofile.
 *
 * Decodes nprofile, builds kind 1059 event via buildGiftWrappedDM,
 * publishes to relays using nostr-tools SimplePool. Resolves once the
 * first relay accepts; rejects if every relay rejects, or with a
 * `TimeoutError` if no relay accepts within `timeoutMs`.
 */
export async function sendDirectMessageToRelays(params: {
  senderPrivateKey: Uint8Array;
  nprofile: string;
  message: string;
  timeoutMs?: number;
}): Promise<void> {
  const decoded = nip19.decode(params.nprofile);
  if (decoded.type !== 'nprofile') {
    console.warn(
      '[sendDirectMessage] Expected nprofile, got:',
      decoded.type,
      '| input:',
      params.nprofile.slice(0, 30)
    );
    throw new Error('Invalid nprofile format');
  }

  const { pubkey, relays } = decoded.data;
  console.info(
    '[sendDirectMessage] Sending NIP-17 DM | pubkey:',
    pubkey.slice(0, 12) + '…',
    '| relayCount:',
    (relays?.length ?? 0) || 'using defaults'
  );
  const relayUrls =
    relays?.length && relays.length > 0
      ? relays
      : [DEFAULT_PAYMENT_RELAY, ...FALLBACK_PAYMENT_RELAYS];
  const uniqueRelays = [...new Set(relayUrls)];

  const wrap = buildGiftWrappedDM({
    content: params.message,
    senderPrivateKey: params.senderPrivateKey,
    recipientPublicKey: pubkey,
  });

  const pool = new SimplePool();
  try {
    await withTimeout(
      Promise.any(pool.publish(uniqueRelays, wrap)),
      params.timeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS,
      'sendDirectMessage publish'
    );
    console.info('[sendDirectMessage] DM published to relays');
  } finally {
    pool.close(uniqueRelays);
  }
}
