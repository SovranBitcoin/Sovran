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
