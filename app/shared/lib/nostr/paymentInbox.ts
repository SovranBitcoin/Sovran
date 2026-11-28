import { facade } from 'nostr';

import { bridgeNostrLoggerOnce } from '@/shared/lib/nostr/nostrLogBridge';
import { DEFAULT_RELAYS } from '@/shared/lib/nostr/outbox/defaults';
import { sharedRelayConnection } from '@/shared/lib/nostr/relayConnection';

// ---------------------------------------------------------------------------
// The payment inbox: the viewer's NIP-17 gift wraps, read and listened for on
// the relays a payer delivers to.
//
// Ecash sent as a direct message and NUT-18 payment-request replies arrive
// here, so this is money. It is deliberately NOT part of the social data
// layer: Settings → Network lets a person switch the relay tier off ("Ask
// relays directly when the cache can't answer"), which is a choice about where
// profiles and contacts load from. With the inbox inside that layer, the same
// switch silently stopped payments arriving. The inbox always uses the relays,
// whatever the tier switches say.
//
// The relays are the ones a payment request advertises (`PAYMENT_RELAYS`, the
// default relay set), over the connection the relay tier uses, so no second
// set of sockets is opened for it.
// ---------------------------------------------------------------------------

export type PaymentInbox = Pick<facade.NostrDataLayer, 'getDmEnvelopes' | 'subscribeDmEnvelopes'>;

let memo: { key: string; inbox: PaymentInbox } | null = null;

/** The inbox, or null when no relay is configured at all. */
export function getPaymentInbox(): PaymentInbox | null {
  bridgeNostrLoggerOnce();
  const relays = DEFAULT_RELAYS;
  if (relays.length === 0) return null;
  const key = relays.join(',');
  if (memo?.key === key) return memo.inbox;
  const tier = facade.relay.createRelayTier({ connection: sharedRelayConnection(relays) });
  // A data layer of the one tier: the same read logging and failure shape the
  // callers already handle. Its entity cache is never written to.
  const inbox = facade.createNostrDataLayer({ tiers: [tier] });
  memo = { key, inbox };
  return inbox;
}
