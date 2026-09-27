/**
 * @jest-environment node
 *
 * Who owns the lock on each kind of ecash payment, and what a kept choice
 * turns into when the send leaves.
 */

import {
  choiceMatchesMode,
  deriveSendLockMode,
  lockSpecForChoice,
  REASON_REQUEST_SETS_LOCK,
  REASON_REQUEST_UNLOCKED,
} from '@/features/send/lib/sendLockControl';
import {
  REASON_MINT_NO_P2PK,
  REASON_NO_RECIPIENT,
  type SendLockGate,
} from '@/features/send/lib/sendLockGate';
import type { CashuP2pkPubkey } from '@/shared/lib/protocolIds';

const ALICE_KEY = `02${'ab'.repeat(32)}` as CashuP2pkPubkey;
const PEER_KEY = `02${'cd'.repeat(32)}`;
const OUR_KEY = `02${'ef'.repeat(32)}`;
const ALICE = 'a'.repeat(64);
const NOW = Date.UTC(2026, 8, 27, 12, 0);

const ready: SendLockGate = { kind: 'ready', lockKey: ALICE_KEY };
const noRecipient: SendLockGate = { kind: 'unavailable', reason: REASON_NO_RECIPIENT };

describe('deriveSendLockMode', () => {
  it('hides the lock on a payment that is not ecash', () => {
    for (const destination of ['meltQuote', 'mintQuote', undefined]) {
      expect(
        deriveSendLockMode({
          ...(destination ? { destination } : {}),
          seededLockKey: null,
          requestLockKey: null,
          gate: noRecipient,
        })
      ).toEqual({ mode: 'hidden' });
    }
  });

  it('keeps a lock the flow arrived with, whoever the recipient is', () => {
    // A Nut Drop: the peer's key is a protocol requirement, not a preference.
    expect(
      deriveSendLockMode({
        destination: 'sendEcash',
        seededLockKey: PEER_KEY,
        requestLockKey: null,
        recipientPubkey: ALICE,
        gate: ready,
      })
    ).toEqual({ mode: 'required', lockKey: PEER_KEY });
    // A scanned wallet receive key names nobody and is still a lock.
    expect(
      deriveSendLockMode({
        destination: 'sendEcash',
        seededLockKey: PEER_KEY,
        requestLockKey: null,
        gate: noRecipient,
      })
    ).toEqual({ mode: 'required', lockKey: PEER_KEY });
  });

  it('leaves the lock to the sender when the payment is to a person', () => {
    expect(
      deriveSendLockMode({
        destination: 'sendEcash',
        seededLockKey: null,
        requestLockKey: null,
        recipientPubkey: ALICE,
        gate: ready,
      })
    ).toEqual({ mode: 'optional', lockKey: ALICE_KEY, confirmed: true });
    expect(
      deriveSendLockMode({
        destination: 'sendEcash',
        seededLockKey: null,
        requestLockKey: null,
        recipientPubkey: ALICE,
        gate: { kind: 'unconfirmed', lockKey: ALICE_KEY, warning: 'x' },
      })
    ).toEqual({ mode: 'optional', lockKey: ALICE_KEY, confirmed: false });
  });

  it('says why when there is nothing to lock to or the mint cannot lock', () => {
    expect(
      deriveSendLockMode({
        destination: 'sendEcash',
        seededLockKey: null,
        requestLockKey: null,
        gate: noRecipient,
      })
    ).toEqual({ mode: 'unavailable', reason: REASON_NO_RECIPIENT, hasRecipient: false });
    expect(
      deriveSendLockMode({
        destination: 'sendEcash',
        seededLockKey: null,
        requestLockKey: null,
        recipientPubkey: ALICE,
        gate: { kind: 'unavailable', reason: REASON_MINT_NO_P2PK },
      })
    ).toEqual({ mode: 'unavailable', reason: REASON_MINT_NO_P2PK, hasRecipient: true });
  });

  it('lets a payment request dictate its own lock', () => {
    expect(
      deriveSendLockMode({
        destination: 'paymentRequest',
        seededLockKey: null,
        requestLockKey: PEER_KEY,
        recipientPubkey: ALICE,
        gate: ready,
      })
    ).toEqual({ mode: 'request', locked: true, reason: REASON_REQUEST_SETS_LOCK });
    expect(
      deriveSendLockMode({
        destination: 'paymentRequest',
        seededLockKey: null,
        requestLockKey: null,
        gate: noRecipient,
      })
    ).toEqual({ mode: 'request', locked: false, reason: REASON_REQUEST_UNLOCKED });
  });
});

describe('lockSpecForChoice', () => {
  it('counts a timed lock from the moment the send leaves', () => {
    const choice = { lockKey: PEER_KEY, durationId: '1h', refundKey: OUR_KEY };
    const tenMinutesLater = NOW + 10 * 60 * 1000;

    expect(lockSpecForChoice(choice, NOW)).toEqual({
      pubkey: PEER_KEY,
      locktimeSec: Math.floor(NOW / 1000) + 3600,
      refundKeys: [OUR_KEY],
    });
    expect(lockSpecForChoice(choice, tenMinutesLater)?.locktimeSec).toBe(
      Math.floor(tenMinutesLater / 1000) + 3600
    );
  });

  it('sends a permanent lock with no locktime and no refund key', () => {
    expect(
      lockSpecForChoice({ lockKey: PEER_KEY, durationId: 'forever', refundKey: OUR_KEY }, NOW)
    ).toEqual({ pubkey: PEER_KEY });
  });

  it('refuses a timed lock it could not take back', () => {
    // Past its locktime, a lock with no refund key opens to whoever holds the
    // token. That is never what the sender was told.
    expect(lockSpecForChoice({ lockKey: PEER_KEY, durationId: '24h' }, NOW)).toBeNull();
  });

  it('has no terms for "off" or a choice it does not know', () => {
    expect(lockSpecForChoice({ lockKey: PEER_KEY, durationId: 'off' }, NOW)).toBeNull();
    expect(lockSpecForChoice({ lockKey: PEER_KEY, durationId: '90d' }, NOW)).toBeNull();
  });
});

describe('choiceMatchesMode', () => {
  const choice = { lockKey: PEER_KEY, durationId: '7d', refundKey: OUR_KEY };

  it('keeps a choice made for the key on screen', () => {
    expect(choiceMatchesMode(choice, { mode: 'required', lockKey: PEER_KEY.toUpperCase() })).toBe(
      true
    );
  });

  it('drops a choice made for another key or another kind of payment', () => {
    expect(choiceMatchesMode(choice, { mode: 'required', lockKey: ALICE_KEY })).toBe(false);
    expect(
      choiceMatchesMode(choice, { mode: 'optional', lockKey: ALICE_KEY, confirmed: true })
    ).toBe(false);
    expect(choiceMatchesMode(choice, { mode: 'hidden' })).toBe(false);
    expect(
      choiceMatchesMode(choice, {
        mode: 'unavailable',
        reason: REASON_MINT_NO_P2PK,
        hasRecipient: true,
      })
    ).toBe(false);
    expect(choiceMatchesMode(null, { mode: 'required', lockKey: PEER_KEY })).toBe(false);
  });
});
