import { describe, expect, it } from 'vitest';

import {
  isMeltQuotePaid,
  isMeltQuoteReadyToPay,
  isMintQuotePaymentObserved,
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
  });
});
