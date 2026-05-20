import { MintQuoteState, MeltQuoteState, type MeltQuoteBolt11Response } from '@cashu/cashu-ts';
import type {
  MintHistoryEntry,
  MeltHistoryEntry,
  SendHistoryEntry,
  ReceiveHistoryEntry,
} from '@cashu/coco-core';

import {
  buildTimeline,
  getCardLabel,
  getStatusColorType,
  getStatusHeader,
} from '@/features/transactions/components/detail/buildTimeline';

const baseFields = {
  id: 'h1',
  createdAt: 1_700_000_000_000,
  mintUrl: 'https://mint.example',
  unit: 'sat',
};

function mintEntry(overrides: Partial<MintHistoryEntry> = {}): MintHistoryEntry {
  return {
    ...baseFields,
    type: 'mint',
    paymentRequest: '',
    quoteId: 'q1',
    state: MintQuoteState.UNPAID,
    amount: 100,
    ...overrides,
  };
}

function meltEntry(overrides: Partial<MeltHistoryEntry> = {}): MeltHistoryEntry {
  return {
    ...baseFields,
    type: 'melt',
    quoteId: 'q1',
    state: MeltQuoteState.UNPAID,
    amount: 100,
    ...overrides,
  };
}

function sendEntry(overrides: Partial<SendHistoryEntry> = {}): SendHistoryEntry {
  return {
    ...baseFields,
    type: 'send',
    operationId: 'op1',
    state: 'prepared',
    amount: 100,
    ...overrides,
  };
}

function receiveEntry(overrides: Partial<ReceiveHistoryEntry> = {}): ReceiveHistoryEntry {
  return {
    ...baseFields,
    type: 'receive',
    state: 'finalized',
    amount: 100,
    ...overrides,
  };
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
