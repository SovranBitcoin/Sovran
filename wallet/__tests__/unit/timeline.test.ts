import { describe, expect, it } from 'vitest';

import { buildTimeline, getCardLabel } from '../../src/history';

describe('history timeline', () => {
  it('renders receive recovery as waiting to redeem', () => {
    const entry = {
      id: 'receive-op-1',
      type: 'receive',
      state: 'executing',
      mintUrl: 'https://mint.example.com',
      amount: 21,
      unit: 'sat',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      operationId: 'op-1',
    } as never;

    const timeline = buildTimeline({
      historyEntry: entry,
      currentTime: 1_700_000_000_000,
    });

    expect(timeline).toEqual([
      expect.objectContaining({
        state: 'accepted',
        displayLabel: 'Token accepted',
        stepType: 'complete',
      }),
      expect.objectContaining({
        state: 'executing',
        displayLabel: 'Waiting to redeem',
        stepType: 'waiting',
        info: "We'll add this ecash to your wallet when you're back online.",
      }),
      expect.objectContaining({
        state: 'redeemed',
        displayLabel: 'Added to wallet',
        stepType: 'future-small',
      }),
    ]);
    expect(getCardLabel(entry, timeline)).toBe('Receive • Waiting');
  });
});

describe('history timeline — incoming payment request (receive)', () => {
  const base = {
    id: 'pr-op-1',
    type: 'receive',
    mintUrl: 'https://mint.example.com',
    amount: 100,
    unit: 'sat',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    operationId: 'op-1',
  };
  const build = (entry: unknown) =>
    buildTimeline({ historyEntry: entry as never, currentTime: 1_700_000_000_000 });

  it('pending request (paymentRequestPending) leads with "waiting for payment"', () => {
    // The list pending row is state:executing but must NOT read "redeeming".
    const timeline = build({
      ...base,
      state: 'executing',
      metadata: { source: 'payment-request', paymentRequestPending: '1' },
    });
    expect(timeline.map((t) => [t.displayLabel, t.stepType])).toEqual([
      ['Requested', 'next-pending'],
      ['Payment received', 'future-small'],
      ['Added to wallet', 'future-small'],
    ]);
    expect(timeline[0].info).toBe('Waiting for payment over Nostr…');
  });

  it('claim in progress (prepared) shows Payment received · Redeeming…', () => {
    const timeline = build({
      ...base,
      state: 'prepared',
      metadata: { source: 'payment-request' },
    });
    expect(timeline.map((t) => [t.displayLabel, t.stepType])).toEqual([
      ['Requested', 'complete'],
      ['Payment received', 'current'],
      ['Added to wallet', 'future-small'],
    ]);
    expect(timeline[1].info).toBe('Redeeming…');
  });

  it('finalized shows Added to wallet as success', () => {
    const timeline = build({
      ...base,
      state: 'finalized',
      metadata: { source: 'payment-request' },
    });
    expect(timeline.map((t) => [t.displayLabel, t.stepType])).toEqual([
      ['Requested', 'complete'],
      ['Payment received', 'complete'],
      ['Added to wallet', 'success'],
    ]);
    expect(timeline[2].info).toContain('100');
  });

  it('a plain token receive is unaffected (no PR metadata)', () => {
    const timeline = build({ ...base, id: 'receive-x', state: 'finalized' });
    expect(timeline.map((t) => t.displayLabel)).toEqual(['Pending', 'Added to wallet']);
  });
});
