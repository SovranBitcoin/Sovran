import { MintQuoteState, MeltQuoteState, type MeltQuoteBolt11Response } from '@cashu/cashu-ts';
import type { HistoryEntry } from '@cashu/coco-core';

import { buildTimeline, getCardLabel, getStatusColorType, getStatusHeader } from 'colada';

const baseFields = {
  id: 'h1',
  source: 'legacy' as const,
  legacyHistoryId: 'h1',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  mintUrl: 'https://mint.example',
  unit: 'sat',
};

function mintEntry(overrides: Record<string, unknown> = {}): HistoryEntry {
  return {
    ...baseFields,
    type: 'mint',
    paymentRequest: '',
    quoteId: 'q1',
    state: MintQuoteState.UNPAID,
    amount: 100,
    ...overrides,
  } as unknown as HistoryEntry;
}

function operationMintEntry(overrides: Record<string, unknown> = {}): HistoryEntry {
  return {
    ...baseFields,
    id: 'mint:op1',
    source: 'operation',
    type: 'mint',
    operationId: 'op1',
    paymentRequest: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080',
    quoteId: 'q1',
    state: 'pending',
    amount: 100,
    metadata: {
      method: 'onchain',
      onchainAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080',
    },
    ...overrides,
  } as unknown as HistoryEntry;
}

function meltEntry(overrides: Record<string, unknown> = {}): HistoryEntry {
  return {
    ...baseFields,
    type: 'melt',
    quoteId: 'q1',
    state: MeltQuoteState.UNPAID,
    amount: 100,
    ...overrides,
  } as unknown as HistoryEntry;
}

function sendEntry(overrides: Record<string, unknown> = {}): HistoryEntry {
  return {
    ...baseFields,
    type: 'send',
    operationId: 'op1',
    state: 'prepared',
    amount: 100,
    ...overrides,
  } as unknown as HistoryEntry;
}

function receiveEntry(overrides: Record<string, unknown> = {}): HistoryEntry {
  return {
    ...baseFields,
    type: 'receive',
    state: 'finalized',
    amount: 100,
    ...overrides,
  } as unknown as HistoryEntry;
}

const NOW = 2_000_000_000_000;

describe('buildTimeline (audit 61.json F-006)', () => {
  describe('mint', () => {
    it('UNPAID renders three steps with the first as next-pending', () => {
      const t = buildTimeline({
        historyEntry: mintEntry({ state: MintQuoteState.UNPAID }),
        currentTime: NOW,
      });
      expect(t).toHaveLength(3);
      expect(t[0]).toMatchObject({ stepType: 'next-pending', state: MintQuoteState.UNPAID });
      expect(t[1].stepType).toBe('future-small');
      expect(t[2].stepType).toBe('future-small');
    });

    it('PAID marks first step complete and second next-pending', () => {
      const t = buildTimeline({
        historyEntry: mintEntry({ state: MintQuoteState.PAID }),
        currentTime: NOW,
      });
      expect(t[0].stepType).toBe('complete');
      expect(t[1].stepType).toBe('next-pending');
      expect(t[2].stepType).toBe('future-small');
    });

    it('ISSUED marks every step complete with success on the last', () => {
      const t = buildTimeline({
        historyEntry: mintEntry({ state: MintQuoteState.ISSUED, amount: 250 }),
        currentTime: NOW,
      });
      expect(t.map((s) => s.stepType)).toEqual(['complete', 'complete', 'success']);
      expect(t[2].info).toContain('250');
    });

    it('operation-backed pending onchain mint waits for address payment', () => {
      const t = buildTimeline({
        historyEntry: operationMintEntry({ state: 'pending' }),
        currentTime: NOW,
      });
      expect(t).toHaveLength(3);
      expect(t[0]).toMatchObject({
        state: MintQuoteState.UNPAID,
        stepType: 'next-pending',
        info: 'Pay the address to receive funds',
      });
      expect(t[1].stepType).toBe('future-small');
      expect(t[2].stepType).toBe('future-small');
    });

    it('operation-backed pending onchain mint shows compact confirmation progress', () => {
      const t = buildTimeline({
        historyEntry: operationMintEntry({ state: 'pending' }),
        currentTime: NOW,
        onchainConfirmationProgress: {
          hasPayment: true,
          hasUnconfirmedPayment: false,
          receivedSats: 100,
          currentConfirmations: 1,
          requiredConfirmations: 6,
          isSatisfied: false,
        },
      });

      expect(t.map((s) => s.stepType)).toEqual(['complete', 'current', 'future-small']);
      expect(t[1]).toMatchObject({
        state: MintQuoteState.PAID,
        displayLabel: 'Payment received',
        info: '1/6 confirmations',
      });
    });

    it('operation-backed executing mint maps to payment received', () => {
      const t = buildTimeline({
        historyEntry: operationMintEntry({ state: 'executing' }),
        currentTime: NOW,
        onchainConfirmationProgress: {
          hasPayment: true,
          hasUnconfirmedPayment: false,
          receivedSats: 100,
          currentConfirmations: 6,
          requiredConfirmations: 6,
          isSatisfied: true,
        },
      });
      expect(t.map((s) => s.stepType)).toEqual(['complete', 'current', 'future-small']);
      expect(t[1].state).toBe(MintQuoteState.PAID);
      expect(t[1].info).toBe('6/6 confirmations');
    });

    it('operation-backed finalized mint maps to issued success', () => {
      const t = buildTimeline({
        historyEntry: operationMintEntry({ state: 'finalized', amount: 321 }),
        currentTime: NOW,
      });
      expect(t.map((s) => s.stepType)).toEqual(['complete', 'complete', 'success']);
      expect(t[2].info).toContain('321');
    });

    it('operation-backed failed mint shows a terminal failure', () => {
      const t = buildTimeline({
        historyEntry: operationMintEntry({ state: 'failed', error: 'Quote expired' }),
        currentTime: NOW,
      });
      expect(t).toHaveLength(2);
      expect(t[1]).toMatchObject({
        state: 'failed',
        displayLabel: 'Failed',
        stepType: 'expired',
        info: 'Quote expired',
      });
    });
  });

  describe('melt', () => {
    it('UNPAID is a waiting state', () => {
      const t = buildTimeline({
        historyEntry: meltEntry({ state: MeltQuoteState.UNPAID }),
        currentTime: NOW,
      });
      expect(t[0].stepType).toBe('next-pending');
    });

    it('PENDING is the active processing state', () => {
      const t = buildTimeline({
        historyEntry: meltEntry({ state: MeltQuoteState.PENDING }),
        currentTime: NOW,
      });
      expect(t[1].stepType).toBe('current');
    });

    it('PAID is a fully successful timeline', () => {
      const t = buildTimeline({
        historyEntry: meltEntry({ state: MeltQuoteState.PAID }),
        currentTime: NOW,
      });
      expect(t.map((s) => s.stepType)).toEqual(['complete', 'complete', 'success']);
    });

    it('expired melt quote yields a single complete + expired step', () => {
      const expiredQuote: MeltQuoteBolt11Response = {
        quote: 'q1',
        request: 'lnbc1...',
        amount: 100,
        fee_reserve: 0,
        state: MeltQuoteState.UNPAID,
        expiry: Math.floor(NOW / 1000) - 60,
        unit: 'sat',
        payment_preimage: null,
      };
      const t = buildTimeline({
        historyEntry: meltEntry({ state: MeltQuoteState.UNPAID }),
        meltQuote: expiredQuote,
        currentTime: NOW,
      });
      expect(t).toHaveLength(2);
      expect(t[1].stepType).toBe('expired');
    });
  });

  describe('send', () => {
    it('standard send prepared shows current step + waiting next', () => {
      const t = buildTimeline({
        historyEntry: sendEntry({ state: 'prepared' }),
        currentTime: NOW,
      });
      expect(t[0].stepType).toBe('current');
      expect(t[1].stepType).toBe('next-pending');
    });

    it('rolledBack standard send produces 2 steps without nostrSent', () => {
      const t = buildTimeline({
        historyEntry: sendEntry({ state: 'rolledBack' }),
        currentTime: NOW,
      });
      expect(t).toHaveLength(2);
      expect(t[1].stepType).toBe('rolled-back');
    });

    it('rolledBack payment request with nostrSent inserts a Delivered step', () => {
      const t = buildTimeline({
        historyEntry: sendEntry({ state: 'rolledBack' }),
        currentTime: NOW,
        nostrSent: true,
      });
      expect(t).toHaveLength(3);
      expect(t[1].state).toBe('nostrSent');
      expect(t[2].stepType).toBe('rolled-back');
    });

    it('payment-request-mode prepared with tokenCreated marks step complete', () => {
      const created = buildTimeline({
        historyEntry: sendEntry({ state: 'prepared' }),
        currentTime: NOW,
        tokenCreated: true,
      });
      expect(created[0].stepType).toBe('complete');

      const creating = buildTimeline({
        historyEntry: sendEntry({ state: 'prepared' }),
        currentTime: NOW,
        tokenCreated: false,
      });
      expect(creating[0].stepType).toBe('next-pending');
    });

    it('payment-request-mode pending without nostrSent shows Delivered as next-pending', () => {
      const t = buildTimeline({
        historyEntry: sendEntry({ state: 'pending' }),
        currentTime: NOW,
        tokenCreated: true,
      });
      expect(t[1].state).toBe('nostrSent');
      expect(t[1].stepType).toBe('next-pending');
    });

    it('payment-request-mode pending with nostrSent shows Claimed as next-pending', () => {
      const t = buildTimeline({
        historyEntry: sendEntry({ state: 'pending' }),
        currentTime: NOW,
        tokenCreated: true,
        nostrSent: true,
      });
      expect(t[1].stepType).toBe('complete');
      expect(t[2].stepType).toBe('next-pending');
    });

    it('payment-request-mode finalized is fully successful', () => {
      const t = buildTimeline({
        historyEntry: sendEntry({ state: 'finalized' }),
        currentTime: NOW,
        tokenCreated: true,
        nostrSent: true,
      });
      expect(t.map((s) => s.stepType)).toEqual(['complete', 'complete', 'success']);
    });
  });

  describe('receive', () => {
    it('prepared shows pending as next-pending and redeemed as future', () => {
      const t = buildTimeline({
        historyEntry: receiveEntry({ state: 'prepared' }),
        currentTime: NOW,
      });
      expect(t[0].stepType).toBe('next-pending');
      expect(t[1].stepType).toBe('future-small');
    });

    it('finalized is fully successful', () => {
      const t = buildTimeline({
        historyEntry: receiveEntry({ state: 'finalized', amount: 750 }),
        currentTime: NOW,
      });
      expect(t.map((s) => s.stepType)).toEqual(['complete', 'success']);
      expect(t[1].info).toContain('750');
    });

    it('rolledBack shows already-spent terminal step', () => {
      const t = buildTimeline({
        historyEntry: receiveEntry({ state: 'rolledBack' }),
        currentTime: NOW,
      });
      expect(t[1].stepType).toBe('already-spent');
    });
  });
});

describe('getCardLabel (audit 61.json F-009)', () => {
  it('mint and receive intentionally collapse to "Receive • …"', () => {
    expect(
      getCardLabel(mintEntry({ state: MintQuoteState.ISSUED }), [
        { state: 's', displayLabel: '', stepType: 'success' },
      ])
    ).toBe('Receive • Complete');
    expect(
      getCardLabel(receiveEntry({ state: 'finalized' }), [
        { state: 's', displayLabel: '', stepType: 'success' },
      ])
    ).toBe('Receive • Complete');
  });

  it('operation-backed mint labels use normalized operation state', () => {
    expect(
      getCardLabel(operationMintEntry({ state: 'finalized' }), [
        { state: 's', displayLabel: '', stepType: 'success' },
      ])
    ).toBe('Receive • Complete');
    expect(
      getCardLabel(operationMintEntry({ state: 'executing' }), [
        { state: 's', displayLabel: '', stepType: 'current' },
      ])
    ).toBe('Receive • In Progress');
    expect(
      getCardLabel(operationMintEntry({ state: 'pending' }), [
        { state: 's', displayLabel: '', stepType: 'next-pending' },
      ])
    ).toBe('Receive • Awaiting Payment');
    expect(
      getCardLabel(operationMintEntry({ state: 'pending' }), [
        { state: MintQuoteState.UNPAID, displayLabel: '', stepType: 'complete' },
        { state: MintQuoteState.PAID, displayLabel: '', stepType: 'next-pending' },
      ])
    ).toBe('Receive • In Progress');
  });

  it('payment-request-mode send labels as "Payment • …"', () => {
    expect(
      getCardLabel(
        sendEntry({ state: 'finalized' }),
        [{ state: 's', displayLabel: '', stepType: 'success' }],
        true,
        true
      )
    ).toBe('Payment • Complete');
  });

  it('standard send labels as "Send • …"', () => {
    expect(
      getCardLabel(sendEntry({ state: 'finalized' }), [
        { state: 's', displayLabel: '', stepType: 'success' },
      ])
    ).toBe('Send • Complete');
  });
});

describe('getStatusColorType', () => {
  it('expired wins over rolled-back', () => {
    expect(
      getStatusColorType([
        { state: 'a', displayLabel: '', stepType: 'expired' },
        { state: 'b', displayLabel: '', stepType: 'rolled-back' },
      ])
    ).toBe('error');
  });

  it('already-spent maps to warning', () => {
    expect(getStatusColorType([{ state: 'a', displayLabel: '', stepType: 'already-spent' }])).toBe(
      'warning'
    );
  });
});

describe('getStatusHeader', () => {
  it('prefers current/success/expired over next-pending', () => {
    expect(
      getStatusHeader([
        { state: 'a', displayLabel: 'Old', stepType: 'complete' },
        { state: 'b', displayLabel: 'Now', stepType: 'current' },
        { state: 'c', displayLabel: 'Next', stepType: 'next-pending' },
      ])
    ).toBe('NOW');
  });

  it('falls back to next-pending when no terminal step exists', () => {
    expect(
      getStatusHeader([
        { state: 'a', displayLabel: 'Done', stepType: 'complete' },
        { state: 'b', displayLabel: 'Wait', stepType: 'next-pending' },
      ])
    ).toBe('WAIT');
  });
});
