/**
 * @fileoverview Pure TS operation for sending NIP-17 direct messages
 *
 * Uses nostr-tools (SimplePool, nip19, buildGiftWrappedDM) instead of NDK.
 * No React hooks or NDK dependency — works as an injectable operation.
 */

import { nip19, SimplePool } from 'nostr-tools';

import { buildGiftWrappedDM } from './nip17';

const DEFAULT_PAYMENT_RELAY = 'wss://relay.vertexlab.io';

const FALLBACK_PAYMENT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.8333.space/',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

/**
 * Send a NIP-17 gift-wrapped direct message to an nprofile.
 *
 * Decodes nprofile, builds kind 1059 event via buildGiftWrappedDM,
 * publishes to relays using nostr-tools SimplePool.
 */
export async function sendDirectMessageToRelays(params: {
  senderPrivateKey: Uint8Array;
  nprofile: string;
  message: string;
}): Promise<void> {
  const decoded = nip19.decode(params.nprofile);
  if (decoded.type !== 'nprofile') {
    console.warn('[sendDirectMessage] Expected nprofile, got:', decoded.type, '| input:', params.nprofile.slice(0, 30));
    throw new Error('Invalid nprofile format');
  }

  const { pubkey, relays } = decoded.data;
  console.info('[sendDirectMessage] Sending NIP-17 DM | pubkey:', pubkey.slice(0, 12) + '…', '| relayCount:', (relays?.length ?? 0) || 'using defaults');
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
    await Promise.any(pool.publish(uniqueRelays, wrap));
    console.info('[sendDirectMessage] DM published to relays');
  } finally {
    pool.close(uniqueRelays);
  }
}
