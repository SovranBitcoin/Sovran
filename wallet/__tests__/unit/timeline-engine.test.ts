import { describe, expect, it } from 'vitest';

import { buildTimeline, buildTimelineModel } from '../../src/history';

const CREATED_AT = 1_700_000_000_000;

const meltEntry = (state: string) =>
  ({
    id: 'melt-op-1',
    type: 'melt',
    state,
    mintUrl: 'https://mint.example.com',
    amount: 5_000,
    unit: 'sat',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    operationId: 'op-1',
    quoteId: 'mq-1',
    metadata: { method: 'onchain', onchainAddress: 'bc1qexample' },
  }) as never;

const mintEntry = (state: string) =>
  ({
    id: 'mint-op-1',
    type: 'mint',
    state,
    mintUrl: 'https://mint.example.com',
    amount: 21_000,
    unit: 'sat',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    quoteId: 'q1',
    paymentRequest: '',
  }) as never;

const sendEntry = (state: string) =>
  ({
    id: 'send-op-1',
    type: 'send',
    state,
    mintUrl: 'https://mint.example.com',
    amount: 100,
    unit: 'sat',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    operationId: 'op-1',
  }) as never;

const receiveEntry = (state: string) =>
  ({
    id: 'receive-op-1',
    type: 'receive',
    state,
    mintUrl: 'https://mint.example.com',
    amount: 100,
    unit: 'sat',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    operationId: 'op-1',
  }) as never;

const progress = (over: Record<string, unknown> = {}) => ({
  hasPayment: false,
  hasUnconfirmedPayment: false,
  receivedSats: 0,
  currentConfirmations: null,
  requiredConfirmations: 6,
  isSatisfied: false,
  ...over,
});

describe('timeline engine — monotonicity (max reached index)', () => {
  // The onchain-melt "Sent" row must be complete whenever ANY later milestone
  // has been reached, even when the melt-state string itself is stale or
  // unrecognised (out-of-order live observations can only advance the flow).
  it('stale UNPAID melt state + confirmed watcher → Sent and network both complete', () => {
    const model = buildTimelineModel({
      historyEntry: meltEntry('UNPAID'),
      currentTime: CREATED_AT,
      onchainConfirmationProgress: progress({
        hasPayment: true,
        currentConfirmations: 6,
        isSatisfied: true,
      }),
    });
    expect(model.steps.map((s) => [s.id, s.stepType])).toEqual([
      ['sending', 'complete'],
      ['network', 'complete'],
      ['confirmed', 'success'],
    ]);
    expect(model.outcome.kind).toBe('settled');
  });

  it('broadcast without a state advance still marks Sent complete', () => {
    const model = buildTimelineModel({
      historyEntry: meltEntry('UNPAID'),
      currentTime: CREATED_AT,
      onchainConfirmationProgress: progress({ hasPayment: true, currentConfirmations: 0 }),
    });
    expect(model.steps.map((s) => [s.id, s.stepType])).toEqual([
      ['sending', 'complete'],
      ['network', 'current'],
      ['confirmed', 'future-small'],
    ]);
    expect(model.steps[1].confirmationRing).toBe(true);
    expect(model.outcome.kind).toBe('pending');
  });

  it('onchain mint: observed deposit advances past "requested" while the quote is UNPAID', () => {
    const model = buildTimelineModel({
      historyEntry: {
        ...(mintEntry('UNPAID') as object),
        metadata: { method: 'onchain', onchainAddress: 'bc1qexample' },
      } as never,
      currentTime: CREATED_AT,
      onchainConfirmationProgress: progress({ hasPayment: true, currentConfirmations: 3 }),
    });
    expect(model.steps.map((s) => [s.id, s.stepType])).toEqual([
      ['requested', 'complete'],
      ['paid', 'current'],
      ['issued', 'future-small'],
    ]);
  });
});

describe('timeline engine — rowKey identity', () => {
  it('milestone steps use their milestone id as rowKey', () => {
    const model = buildTimelineModel({
      historyEntry: mintEntry('PAID'),
      currentTime: CREATED_AT,
    });
    expect(model.steps.map((s) => s.id)).toEqual(['requested', 'paid', 'issued']);
    expect(model.steps.map((s) => s.rowKey)).toEqual(['requested', 'paid', 'issued']);
  });

  it('mint failed terminal inherits the displaced "paid" slot rowKey', () => {
    const model = buildTimelineModel({
      historyEntry: mintEntry('failed'),
      currentTime: CREATED_AT,
    });
    expect(model.steps.map((s) => [s.id, s.rowKey])).toEqual([
      ['requested', 'requested'],
      ['failed', 'paid'],
    ]);
    expect(model.outcome.kind).toBe('failed');
  });

  it('lightning melt expired terminal inherits the displaced "pending" slot rowKey', () => {
    const expiredQuote = {
      quote: 'mq-1',
      request: 'lnbc1...',
      amount: 100,
      fee_reserve: 0,
      state: 'UNPAID',
      expiry: Math.floor(CREATED_AT / 1000) - 60,
      unit: 'sat',
      payment_preimage: null,
    } as never;
    const model = buildTimelineModel({
      historyEntry: {
        ...(meltEntry('UNPAID') as object),
        metadata: undefined,
      } as never,
      meltQuote: expiredQuote,
      currentTime: CREATED_AT,
    });
    expect(model.steps.map((s) => [s.id, s.rowKey])).toEqual([
      ['unpaid', 'unpaid'],
      ['expired', 'pending'],
    ]);
    expect(model.outcome.kind).toBe('expired');
    expect(model.expiresAt).toBe((Math.floor(CREATED_AT / 1000) - 60) * 1000);
  });

  it('send rolled-back terminal displaces the slot after the last kept row', () => {
    const plain = buildTimelineModel({
      historyEntry: sendEntry('rolledBack'),
      currentTime: CREATED_AT,
    });
    expect(plain.steps.map((s) => [s.id, s.rowKey])).toEqual([
      ['prepared', 'prepared'],
      ['rolled-back', 'pending'],
    ]);

    const delivered = buildTimelineModel({
      historyEntry: sendEntry('rolledBack'),
      currentTime: CREATED_AT,
      nostrSent: true,
    });
    expect(delivered.steps.map((s) => [s.id, s.rowKey])).toEqual([
      ['prepared', 'prepared'],
      ['nostr-sent', 'nostr-sent'],
      ['rolled-back', 'finalized'],
    ]);
  });

  it('receive already-spent terminal inherits the "redeemed" slot rowKey', () => {
    const model = buildTimelineModel({
      historyEntry: receiveEntry('rolledBack'),
      currentTime: CREATED_AT,
    });
    expect(model.steps.map((s) => [s.id, s.rowKey])).toEqual([
      ['pending', 'pending'],
      ['already-spent', 'redeemed'],
    ]);
    expect(model.outcome.kind).toBe('already-spent');
  });
});

describe('timeline engine — off-chain settlement collapse', () => {
  it('the settled-offchain step shares the network slot rowKey', () => {
    const model = buildTimelineModel({
      historyEntry: meltEntry('PAID'),
      currentTime: CREATED_AT,
      onchainConfirmationProgress: progress(),
      onchainSettledInternally: true,
    });
    expect(model.steps.map((s) => [s.id, s.rowKey, s.stepType])).toEqual([
      ['sending', 'sending', 'complete'],
      ['settled-offchain', 'network', 'success'],
    ]);
    expect(model.outcome.kind).toBe('settled');
  });
});

describe('timeline engine — legacy buildTimeline contract', () => {
  it('buildTimeline strips id/rowKey and keeps the pre-engine field set', () => {
    const items = buildTimeline({
      historyEntry: mintEntry('ISSUED'),
      currentTime: CREATED_AT,
    });
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(
        expect.arrayContaining(['displayLabel', 'state', 'stepType']),
      );
      expect('id' in item).toBe(false);
      expect('rowKey' in item).toBe(false);
    }
  });

  it('unknown states produce an empty model with the "empty" outcome', () => {
    const model = buildTimelineModel({
      historyEntry: sendEntry('exploded'),
      currentTime: CREATED_AT,
    });
    expect(model.steps).toEqual([]);
    expect(model.outcome.kind).toBe('empty');
  });
});
