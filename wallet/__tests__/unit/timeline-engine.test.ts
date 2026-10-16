import { describe, expect, it } from 'vitest';

import { buildTimeline, buildTimelineModel } from '../../src/history';

const CREATED_AT = 1_700_000_000_000;
const base = {
  mintUrl: 'https://mint.example.com',
  unit: 'sat',
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  operationId: 'op-1',
};

const meltEntry = (state: string) =>
  ({
    ...base,
    id: 'melt-op-1',
    type: 'melt',
    state,
    amount: 5_000,
    quoteId: 'mq-1',
    metadata: { method: 'onchain', onchainAddress: 'bc1qexample' },
  }) as never;

const mintEntry = (state: string, extra: Record<string, unknown> = {}) =>
  ({
    ...base,
    id: 'mint-op-1',
    type: 'mint',
    state,
    amount: 21_000,
    quoteId: 'q1',
    paymentRequest: '',
    ...extra,
  }) as never;

const sendEntry = (state: string, extra: Record<string, unknown> = {}) =>
  ({ ...base, id: 'send-op-1', type: 'send', state, amount: 100, ...extra }) as never;

const receiveEntry = (state: string, error?: string) =>
  ({
    ...base,
    id: 'receive-op-1',
    type: 'receive',
    state,
    amount: 100,
    ...(error ? { error } : {}),
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

const shape = (model: ReturnType<typeof buildTimelineModel>) =>
  model.steps.map((step) => [step.rowKey, step.id, step.stepType]);

describe('timeline engine — the shape of every timeline', () => {
  it('is every finished event plus exactly one open slot', () => {
    const model = buildTimelineModel({
      historyEntry: mintEntry('PAID'),
      currentTime: CREATED_AT,
    });
    expect(shape(model)).toEqual([
      ['created', 'created', 'complete'],
      ['paid', 'paid', 'complete'],
      ['issued', 'issued', 'current'],
    ]);
    expect(model.outcome.kind).toBe('pending');
    expect(model.doneRowKeys).toEqual(['created', 'paid']);
  });

  it('previews nothing beyond the open slot', () => {
    const model = buildTimelineModel({
      historyEntry: mintEntry('UNPAID'),
      currentTime: CREATED_AT,
    });
    expect(model.steps.map((step) => step.rowKey)).toEqual(['created', 'paid']);
  });

  it('a flow that ran to its end closes on a success row and reads as settled', () => {
    const model = buildTimelineModel({
      historyEntry: mintEntry('ISSUED'),
      currentTime: CREATED_AT,
    });
    expect(model.steps.map((step) => step.stepType)).toEqual(['complete', 'complete', 'success']);
    expect(model.outcome.kind).toBe('settled');
  });
});

describe('timeline engine — monotonicity (furthest finished event wins)', () => {
  // A later observation arriving first must still mark everything before it
  // as having happened, even when the state string is stale or unrecognised.
  it('stale UNPAID melt state + a deep transaction → every earlier event complete, the last left to the mint', () => {
    const model = buildTimelineModel({
      historyEntry: meltEntry('UNPAID'),
      currentTime: CREATED_AT,
      onchainConfirmationProgress: progress({
        hasPayment: true,
        currentConfirmations: 6,
        isSatisfied: true,
      }),
    });
    expect(shape(model)).toEqual([
      ['created', 'created', 'complete'],
      ['submitted', 'submitted', 'complete'],
      ['broadcast', 'broadcast', 'complete'],
      ['confirmed', 'confirmed', 'next-pending'],
    ]);
  });

  it('broadcast without a state advance still marks the hand-over complete', () => {
    const model = buildTimelineModel({
      historyEntry: meltEntry('UNPAID'),
      currentTime: CREATED_AT,
      onchainConfirmationProgress: progress({ hasPayment: true, hasUnconfirmedPayment: true }),
    });
    expect(model.steps.map((step) => step.stepType)).toEqual([
      'complete',
      'complete',
      'complete',
      'current',
    ]);
  });
});

describe('timeline engine — outcomes land in the open slot', () => {
  it('the outcome inherits the rowKey of the slot that was waiting', () => {
    const waiting = buildTimelineModel({
      historyEntry: sendEntry('pending'),
      currentTime: CREATED_AT,
    });
    const reversed = buildTimelineModel({
      historyEntry: sendEntry('rolled_back'),
      currentTime: CREATED_AT,
      doneRowKeys: waiting.doneRowKeys,
    });
    expect(shape(waiting)).toEqual([
      ['created', 'created', 'complete'],
      ['claimed', 'claimed', 'next-pending'],
    ]);
    expect(shape(reversed)).toEqual([
      ['created', 'created', 'complete'],
      ['claimed', 'rolled-back', 'rolled-back'],
    ]);
    expect(reversed.outcome.kind).toBe('rolled-back');
  });

  it('receive: a rejection takes the "added" slot', () => {
    const model = buildTimelineModel({
      historyEntry: receiveEntry('rolled_back', 'Token already spent'),
      currentTime: CREATED_AT,
    });
    expect(shape(model)).toEqual([
      ['received', 'received', 'complete'],
      ['added', 'already-spent', 'already-spent'],
    ]);
    expect(model.outcome.kind).toBe('already-spent');
  });

  it('off-chain settlement takes the slot that was waiting for the broadcast', () => {
    const model = buildTimelineModel({
      historyEntry: meltEntry('PAID'),
      currentTime: CREATED_AT,
      onchainConfirmationProgress: progress(),
      onchainSettledInternally: true,
    });
    expect(shape(model)).toEqual([
      ['created', 'created', 'complete'],
      ['submitted', 'submitted', 'complete'],
      ['broadcast', 'settled-offchain', 'success'],
    ]);
    expect(model.outcome.kind).toBe('settled');
  });
});

describe('timeline engine — rows already drawn are never taken back', () => {
  // A terminal state forgets how far the flow got. The entry is asked first;
  // what the renderer already drew is the witness of last resort.
  it('a rollback seen live keeps the rows the entry can no longer prove', () => {
    const cold = buildTimelineModel({
      historyEntry: mintEntry('failed'),
      currentTime: CREATED_AT,
    });
    expect(cold.steps.map((step) => step.rowKey)).toEqual(['created', 'paid']);

    const live = buildTimelineModel({
      historyEntry: mintEntry('failed'),
      currentTime: CREATED_AT,
      doneRowKeys: ['created', 'paid'],
    });
    expect(shape(live)).toEqual([
      ['created', 'created', 'complete'],
      ['paid', 'paid', 'complete'],
      ['issued', 'failed', 'expired'],
    ]);
  });

  it('coco stepping a mint back from executing to pending does not un-receive the payment', () => {
    const model = buildTimelineModel({
      historyEntry: mintEntry('pending'),
      currentTime: CREATED_AT,
      doneRowKeys: ['created', 'paid'],
    });
    expect(shape(model)).toEqual([
      ['created', 'created', 'complete'],
      ['paid', 'paid', 'complete'],
      ['issued', 'issued', 'current'],
    ]);
  });

  it('the open slot is not reported as drawn-and-finished', () => {
    const model = buildTimelineModel({
      historyEntry: sendEntry('rolled_back', { token: { proofs: [{ secret: 'x' }] } }),
      currentTime: CREATED_AT,
    });
    expect(model.doneRowKeys).toEqual(['created']);
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

  it('a state the flow does not know gets one honest row, not a blank card or a guess', () => {
    const model = buildTimelineModel({
      historyEntry: sendEntry('exploded'),
      currentTime: CREATED_AT,
    });
    expect(model.steps.map((step) => [step.id, step.displayLabel, step.stepType])).toEqual([
      ['unknown', 'Status unavailable', 'waiting'],
    ]);
    expect(model.outcome.kind).toBe('pending');
    expect(model.doneRowKeys).toEqual([]);
  });
});
