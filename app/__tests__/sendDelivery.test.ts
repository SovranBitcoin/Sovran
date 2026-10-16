/**
 * @jest-environment node
 */

import {
  describeSendDelivery,
  requestCarrierOf,
  type SendCarrier,
} from '@/features/send/lib/sendDelivery';

const CARRIERS: SendCarrier[] = ['scan', 'bluetooth', 'nostr', 'server'];
const EXACT = [true, false, null] as const;

const base = {
  destination: 'sendEcash',
  lockMode: 'optional',
  locked: false,
  recipientName: 'Alice',
  canSendOffline: null,
  carrier: 'scan',
} as const;

describe('describeSendDelivery', () => {
  it('says nothing for a payment that is not ecash', () => {
    expect(describeSendDelivery({ ...base, destination: 'meltQuote', lockMode: 'hidden' })).toBe(
      null
    );
  });

  // Every combination of lock, carrier and exactness, against the one rule.
  describe.each([true, false])('locked: %s', (locked) => {
    describe.each(CARRIERS)('carried by %s', (carrier) => {
      it.each(EXACT)('held exactly: %s', (canSendOffline) => {
        const delivery = describeSendDelivery({ ...base, locked, carrier, canSendOffline })!;
        const carrierOffline = carrier === 'scan' || carrier === 'bluetooth';

        expect(delivery.lock).toBe(locked ? 'locked' : 'unlocked');
        expect(delivery.carrier).toBe(carrier);
        // A lock is a swap, whatever proofs are held.
        expect(delivery.needsMint).toBe(
          locked ? true : canSendOffline === null ? null : !canSendOffline
        );
        const offline = !locked && canSendOffline === true && carrierOffline;
        const unknown = !locked && canSendOffline === null && carrierOffline;
        expect(delivery.network).toBe(offline ? 'not-needed' : unknown ? 'unknown' : 'needed');
      });
    });
  });

  it('is never offline when locked, even over Bluetooth with exact proofs', () => {
    const delivery = describeSendDelivery({
      ...base,
      lockMode: 'required',
      locked: true,
      carrier: 'bluetooth',
      canSendOffline: true,
    })!;
    expect(delivery.network).toBe('needed');
    expect(delivery.headline).toBe('Locked to Alice · needs internet');
    expect(delivery.detail).toBe('The mint applies the lock. Sent to Alice over Bluetooth.');
  });

  it('is never offline to a contact, even unlocked with exact proofs', () => {
    const delivery = describeSendDelivery({ ...base, carrier: 'nostr', canSendOffline: true })!;
    expect(delivery).toMatchObject({ needsMint: false, network: 'needed' });
    expect(delivery.detail).toBe('Sent to Alice over Nostr.');
  });

  it('needs nothing but the two phones for an exact, unlocked amount shown to scan', () => {
    const delivery = describeSendDelivery({ ...base, recipientName: null, canSendOffline: true })!;
    expect(delivery).toMatchObject({ network: 'not-needed', headline: 'No internet needed' });
    expect(delivery.detail).toBe('They scan the QR code or tap by NFC.');
  });

  it('names the mint when the amount has to be made', () => {
    expect(describeSendDelivery({ ...base, canSendOffline: false })!.detail).toBe(
      'The mint makes this amount. Alice scans the QR code or taps by NFC.'
    );
  });

  it('words a payment request as the request, not a person', () => {
    const delivery = describeSendDelivery({
      ...base,
      destination: 'paymentRequest',
      lockMode: 'request',
      locked: true,
      recipientName: null,
      carrier: 'nostr',
    })!;
    expect(delivery.headline).toBe('Locked by the request · needs internet');
  });
});

describe('requestCarrierOf', () => {
  it('reads no transport as in-band, and a listed server ahead of Nostr', () => {
    expect(requestCarrierOf(undefined)).toBe('scan');
    expect(requestCarrierOf([])).toBe('scan');
    // The wallet posts whenever a server is listed; Nostr only when alone.
    expect(requestCarrierOf([{ type: 'nostr' }, { type: 'post' }])).toBe('server');
    expect(requestCarrierOf([{ type: 'nostr' }])).toBe('nostr');
    expect(requestCarrierOf([{ type: 'post' }])).toBe('server');
  });
});
