import { describe, expect, it } from 'vitest';

import type { HistoryEntry, ReceiveOperation } from '@cashu/coco-core';
import {
  bucketTransaction,
  inFlightReceiveToHistoryEntry,
  isMeltQuotePaid,
  isMeltQuoteReadyToPay,
  isMintExpired,
  isMintQuotePaymentObserved,
  isPendingTransaction,
  isReceiveTokenPending,
  isReceiveTokenRedeemed,
  isReservedSendHistoryEntry,
  isSendTokenCancelled,
  isSendTokenComplete,
  isSettledReceiveHistoryEntry,
  isSettledSpendHistoryEntry,
} from '../../src/history';

describe('history state filters', () => {
  it('detects observed mint quote payment states', () => {
    expect(isMintQuotePaymentObserved({ state: 'executing' })).toBe(true);
    expect(isMintQuotePaymentObserved({ state: 'finalized' })).toBe(true);
    expect(isMintQuotePaymentObserved({ state: 'PAID' })).toBe(true);
    expect(isMintQuotePaymentObserved({ state: 'pending', remoteState: 'PAID' })).toBe(true);
    expect(isMintQuotePaymentObserved({ state: 'pending', remoteState: 'ISSUED' })).toBe(true);
    expect(isMintQuotePaymentObserved({ state: 'ISSUED' })).toBe(true);

    expect(isMintQuotePaymentObserved({ state: 'pending' })).toBe(false);
    expect(isMintQuotePaymentObserved({ state: 'failed' })).toBe(false);
    expect(isMintQuotePaymentObserved(null)).toBe(false);
  });

  it('classifies melt quote detail states', () => {
    expect(isMeltQuotePaid({ state: 'finalized' })).toBe(true);
    expect(isMeltQuotePaid({ state: 'PAID' })).toBe(true);
    expect(isMeltQuoteReadyToPay({ state: 'prepared' })).toBe(true);
    expect(isMeltQuoteReadyToPay({ state: 'UNPAID' })).toBe(true);

    expect(isMeltQuotePaid({ state: 'pending' })).toBe(false);
    expect(isMeltQuoteReadyToPay({ state: 'pending' })).toBe(false);
  });

  it('classifies token detail terminal states', () => {
    expect(isReceiveTokenRedeemed({ state: 'finalized' })).toBe(true);
    expect(isReceiveTokenPending({ state: 'executing' })).toBe(true);
    expect(isSendTokenComplete({ state: 'finalized' })).toBe(true);
    expect(isSendTokenCancelled({ state: 'rolledBack' })).toBe(true);
    expect(isSendTokenCancelled({ state: 'rolled_back' })).toBe(true);

    expect(isReceiveTokenRedeemed({ state: 'pending' })).toBe(false);
    expect(isReceiveTokenPending({ state: 'finalized' })).toBe(false);
    expect(isSendTokenComplete({ state: 'pending' })).toBe(false);
    expect(isSendTokenCancelled({ state: 'pending' })).toBe(false);
  });

  it('classifies chart and balance state predicates', () => {
    expect(isReservedSendHistoryEntry({ type: 'send', state: 'prepared' } as never)).toBe(true);
    expect(isReservedSendHistoryEntry({ type: 'send', state: 'finalized' } as never)).toBe(false);

    expect(isSettledSpendHistoryEntry({ type: 'send', state: 'finalized' } as never)).toBe(true);
    expect(isSettledSpendHistoryEntry({ type: 'melt', state: 'PAID' } as never)).toBe(true);
    expect(isSettledSpendHistoryEntry({ type: 'melt', state: 'UNPAID' } as never)).toBe(false);

    expect(isSettledReceiveHistoryEntry({ type: 'receive', state: 'finalized' } as never)).toBe(
      true,
    );
    expect(isSettledReceiveHistoryEntry({ type: 'mint', state: 'PAID' } as never)).toBe(true);
    expect(isSettledReceiveHistoryEntry({ type: 'mint', state: 'UNPAID' } as never)).toBe(false);
    // A fully-credited deposit settles to ISSUED (v2 finalized), NOT PAID — it
    // must still count as received. Regression: "Received this month" dropped
    // every completed Lightning/bolt12/onchain deposit.
    expect(isSettledReceiveHistoryEntry({ type: 'mint', state: 'ISSUED' } as never)).toBe(true);
    expect(isSettledReceiveHistoryEntry({ type: 'mint', state: 'finalized' } as never)).toBe(true);
    expect(isSettledReceiveHistoryEntry({ type: 'mint', state: 'executing' } as never)).toBe(true);
  });
});

describe('transaction bucketing', () => {
  it('treats a receive in executing state as pending', () => {
    expect(isPendingTransaction({ type: 'receive', state: 'executing' } as never)).toBe(true);
    expect(isPendingTransaction({ type: 'receive', state: 'finalized' } as never)).toBe(false);
    // sends still bucket via cancellable states
    expect(isPendingTransaction({ type: 'send', state: 'pending' } as never)).toBe(true);
    expect(isPendingTransaction({ type: 'send', state: 'finalized' } as never)).toBe(false);
  });

  it('guards isMintExpired to unpaid mint entries (no false positives)', () => {
    expect(isMintExpired({ type: 'send', state: 'UNPAID' } as never)).toBe(false);
    expect(isMintExpired({ type: 'mint', state: 'PAID' } as never)).toBe(false);
    // UNPAID mint without a payment request cannot be decoded -> not expired
    expect(isMintExpired({ type: 'mint', state: 'UNPAID' } as never)).toBe(false);
  });

  it('buckets entries into pending / confirmed / expired', () => {
    expect(bucketTransaction({ type: 'receive', state: 'executing' } as never)).toBe('pending');
    expect(bucketTransaction({ type: 'send', state: 'pending' } as never)).toBe('pending');
    expect(bucketTransaction({ type: 'receive', state: 'finalized' } as never)).toBe('confirmed');
    expect(bucketTransaction({ type: 'send', state: 'finalized' } as never)).toBe('confirmed');
    // collapsing-ghost override keeps a settled send pinned in pending
    expect(
      bucketTransaction({ type: 'send', state: 'rolled_back' } as never, {
        isCollapsingGhost: true,
      }),
    ).toBe('pending');
  });
});

describe('inFlightReceiveToHistoryEntry', () => {
  const op = {
    id: 'op-1',
    state: 'executing',
    mintUrl: 'https://mint.example',
    unit: 'sat',
    amount: 2100,
    inputProofs: [],
    createdAt: 1700000000000,
    updatedAt: 1700000005000,
  } as unknown as ReceiveOperation;

  it('maps an executing receive op into a pending receive entry', () => {
    const entry = inFlightReceiveToHistoryEntry(op);
    expect(entry).toMatchObject({
      id: 'receive-op-1',
      type: 'receive',
      operationId: 'op-1',
      amount: 2100,
      state: 'executing',
    });
  });

  it('produces an entry that buckets as pending', () => {
    expect(bucketTransaction(inFlightReceiveToHistoryEntry(op) as HistoryEntry)).toBe('pending');
  });

  it('defaults a missing unit to sat', () => {
    const entry = inFlightReceiveToHistoryEntry({
      ...op,
      unit: undefined,
    } as unknown as ReceiveOperation);
    expect(entry.unit).toBe('sat');
  });
});
