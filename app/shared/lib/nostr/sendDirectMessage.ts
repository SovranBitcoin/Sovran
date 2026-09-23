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
 *
 * Where the wrap goes is NIP-17's decision, not ours. The nprofile's own relay
 * hints win: in a NUT-18 request the payee named that target themselves, which
 * is a stronger statement of "reach me here" than anything we could look up.
 * With no hints we fall back to their `kind:10050` DM relay list, and with
 * neither we refuse — NIP-17 makes a missing list mean "not ready to receive",
 * and this payload carries live proofs, so guessing a relay set spends the
 * sender's ecash into a mailbox the payee never opens.
 *
 * The relay pool and the DM-relay lookup are injected through
 * `createDirectMessageSender`, so tests can supply fakes;
 * `sendDirectMessageToRelays` is the app's `SimplePool` wiring.
 */

import { SimplePool } from 'nostr-tools/pool';
import * as nip19 from 'nostr-tools/nip19';

import { withTimeout } from 'wallet';

import { nostrLog } from '@/shared/lib/logger';
import { createDmRelayResolver } from '@/shared/lib/nostr/dmRelayDiscovery';

import { buildRecipientGiftWrap } from './nip17';

const DEFAULT_PAYMENT_RELAY = 'wss://relay.vertexlab.io';

const FALLBACK_PAYMENT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.8333.space/',
  'wss://nos.lol',
  'wss://relay.nostr.band',
];

/**
 * The relay set we advertise as our own inbox: embedded as the relay hints in
 * the NUT-18 nostr-transport nprofiles we hand out, and queried when we need to
 * discover somebody else's `kind:10050`.
 *
 * It is deliberately not a publish target for a counterparty's DM. Our own
 * requests always carry these as hints, so a hint-less nprofile is always
 * somebody else's, and these relays say nothing about where *they* read.
 */
export const PAYMENT_RELAYS = [DEFAULT_PAYMENT_RELAY, ...FALLBACK_PAYMENT_RELAYS];

/** How long to wait for the first relay OK before failing the publish. */
const DEFAULT_PUBLISH_TIMEOUT_MS = 15_000;

/** The slice of nostr-tools' `SimplePool` this publisher needs. */
export type DirectMessageRelayPool = Pick<SimplePool, 'publish' | 'close'>;

/**
 * The recipient declared no inbox: no relay hints on their nprofile and no
 * `kind:10050` DM relay list. NIP-17 says not to send, and the caller
 * (`executePaymentRequest`) rolls the prepared proofs back on this throw.
 */
export class NoDirectMessageRelaysError extends Error {
  readonly pubkey: string;
  constructor(pubkey: string) {
    super("This contact hasn't published where to reach them, so the payment wasn't sent.");
    this.name = 'NoDirectMessageRelaysError';
    this.pubkey = pubkey;
  }
}

interface SendDirectMessageParams {
  senderPrivateKey: Uint8Array;
  nprofile: string;
  message: string;
  timeoutMs?: number;
}

/**
 * Build a DM publisher over an injected relay-pool factory. Each publish opens
 * a pool, publishes, and closes the relays it used.
 */
export function createDirectMessageSender(deps: {
  openPool: () => DirectMessageRelayPool;
  /** NIP-17 `kind:10050` lookup, used only when the nprofile carries no hints. */
  resolveDmRelays: (pubkey: string) => Promise<string[]>;
}): (params: SendDirectMessageParams) => Promise<void> {
  return async function sendDirectMessage(params) {
    const decoded = nip19.decode(params.nprofile);
    if (decoded.type !== 'nprofile') {
      nostrLog.warn('nostr.sendDirectMessage.invalidNprofile', {
        decodedType: decoded.type,
        inputPreview: params.nprofile.slice(0, 30),
      });
      throw new Error('Invalid nprofile format');
    }

    const { pubkey, relays } = decoded.data;
    const hinted = [...new Set(relays ?? [])];
    // No hints: ask the recipient where they read DMs. Never guess — a wrap on
    // the wrong relay is spent ecash the payee will never see.
    const relayUrls = hinted.length > 0 ? hinted : await deps.resolveDmRelays(pubkey);
    const uniqueRelays = [...new Set(relayUrls)];

    nostrLog.info('nostr.sendDirectMessage.publish', {
      pubkeyPreview: pubkey.slice(0, 12) + '…',
      relayCount: uniqueRelays.length,
      source: hinted.length > 0 ? 'nprofile' : 'kind10050',
    });

    if (uniqueRelays.length === 0) {
      nostrLog.warn('nostr.sendDirectMessage.noDeclaredRelays', {
        pubkeyPreview: pubkey.slice(0, 12) + '…',
      });
      throw new NoDirectMessageRelaysError(pubkey);
    }

    const { recipientWrap } = buildRecipientGiftWrap({
      content: params.message,
      senderPrivateKey: params.senderPrivateKey,
      recipientPublicKey: pubkey,
    });

    const pool = deps.openPool();
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
  };
}

/** App wiring: a short-lived nostr-tools `SimplePool` per publish, and a
 *  `kind:10050` lookup over the relays we already keep open for payments. */
export const sendDirectMessageToRelays = createDirectMessageSender({
  openPool: () => new SimplePool(),
  resolveDmRelays: createDmRelayResolver({
    openPool: () => new SimplePool(),
    discoveryRelays: PAYMENT_RELAYS,
  }),
});
