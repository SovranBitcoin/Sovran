/**
 * What the amount screen tells the sender about the ecash before it leaves:
 * who can take it, and whether making and carrying it needs a network.
 *
 * Three facts, and only the last is derived:
 *
 *   - Lock. Whether the ecash is locked to a key (NUT-11).
 *   - Mint. Whether the mint has to act before the ecash exists. Proofs the
 *     wallet already holds that add up to the amount exactly are the token
 *     (ADR 0019); any other amount is a swap, and so is every lock.
 *   - Carrier. How the ecash reaches the other side once it exists: shown for
 *     the other phone to scan or tap, sent over the Bluetooth mesh, sent as a
 *     Nostr message, or posted to a server. The flow decides this before an
 *     amount is typed, and only the first two work with no internet. A Nut
 *     Drop also tries Nostr alongside the mesh when the peer advertises it;
 *     Bluetooth is the carrier it can complete on alone.
 *
 * The payment can complete offline exactly when the mint is not needed and
 * the carrier does not need the internet. So a locked send is never offline,
 * whatever carries it, and a send to a contact is never offline, whatever the
 * amount.
 *
 * Pure: no hooks, no I/O, so every row of the table is a unit test.
 */

import type { SendLockMode } from './sendLockControl';

/** How the ecash reaches the other side. */
export type SendCarrier = 'scan' | 'bluetooth' | 'nostr' | 'server';

export interface SendDelivery {
  lock: 'locked' | 'unlocked';
  /** Null until an amount is entered, or where the wallet does not work it out. */
  needsMint: boolean | null;
  carrier: SendCarrier;
  /** `unknown` only while `needsMint` is, and the carrier could go offline. */
  network: 'not-needed' | 'needed' | 'unknown';
  /** The one thing to know, in a few words. */
  headline: string;
  /** Why: what the mint does, then how it gets there. */
  detail: string;
}

interface SendDeliveryInput {
  destination?: string;
  lockMode: SendLockMode['mode'];
  locked: boolean;
  /** Who the ecash is for, when the flow knows. */
  recipientName: string | null;
  /** Whether held proofs make the amount exactly; null when not worked out. */
  canSendOffline: boolean | null;
  carrier: SendCarrier;
}

const OFFLINE_CARRIERS: readonly SendCarrier[] = ['scan', 'bluetooth'];

/**
 * The carrier a NUT-18 request will actually be paid over. A request may list
 * several transports; the wallet posts to the server whenever one is listed
 * and uses Nostr only when it is the sole transport (`executePaymentRequest`).
 * No transport means in-band: the ecash is handed over by other means.
 */
export function requestCarrierOf(transports: readonly { type: string }[] | undefined): SendCarrier {
  if (!transports?.length) return 'scan';
  if (transports.some((t) => t.type === 'post')) return 'server';
  if (transports.some((t) => t.type === 'nostr')) return 'nostr';
  return 'server';
}

function carrySentence(carrier: SendCarrier, name: string | null, isRequest: boolean): string {
  switch (carrier) {
    case 'nostr':
      return name ? `Sent to ${name} over Nostr.` : 'Sent over Nostr.';
    case 'bluetooth':
      return name ? `Sent to ${name} over Bluetooth.` : 'Sent over Bluetooth.';
    case 'server':
      return "Sent to the requester's server.";
    case 'scan':
      return isRequest
        ? 'You hand it over yourself.'
        : `${name ?? 'They'} scan${name ? 's' : ''} the QR code or tap${name ? 's' : ''} by NFC.`;
  }
}

export function describeSendDelivery(input: SendDeliveryInput): SendDelivery | null {
  const { destination, lockMode, locked, recipientName, canSendOffline, carrier } = input;
  if (lockMode === 'hidden') return null;

  const isRequest = destination === 'paymentRequest';
  const needsMint = locked ? true : canSendOffline === null ? null : !canSendOffline;
  const carrierOffline = OFFLINE_CARRIERS.includes(carrier);
  const network =
    needsMint === true || !carrierOffline
      ? 'needed'
      : needsMint === false
        ? 'not-needed'
        : 'unknown';

  const lockedTo = isRequest
    ? 'Locked by the request'
    : `Locked to ${recipientName ?? 'their key'}`;
  const state =
    network === 'not-needed'
      ? 'No internet needed'
      : network === 'needed'
        ? 'Needs internet'
        : 'Not locked';
  const headline = locked ? `${lockedTo} · needs internet` : state;

  const make = locked
    ? 'The mint applies the lock. '
    : needsMint === true
      ? 'The mint makes this amount. '
      : '';

  return {
    lock: locked ? 'locked' : 'unlocked',
    needsMint,
    carrier,
    network,
    headline,
    detail: `${make}${carrySentence(carrier, recipientName, isRequest)}`,
  };
}
