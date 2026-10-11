import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '@cashu/coco-core';

import { sumAmounts, sumReservedSends } from '../../src/balance';

function entry(partial: Record<string, unknown>): HistoryEntry {
  return partial as unknown as HistoryEntry;
}

describe('sumAmounts', () => {
  it('sums mixed amount representations', () => {
    expect(sumAmounts([10, '5', 2n, { toNumber: () => 3 }])).toBe(20);
  });
});

describe('sumReservedSends', () => {
  it('sums only cancellable pending/prepared sends', () => {
    const history = [
      entry({ id: 's1', type: 'send', state: 'pending', amount: 100 }),
      entry({ id: 's2', type: 'send', state: 'prepared', amount: 50 }),
      entry({ id: 's3', type: 'send', state: 'finalized', amount: 999 }),
      entry({ id: 'r1', type: 'receive', state: 'executing', amount: 7 }),
      entry({ id: 'm1', type: 'mint', state: 'UNPAID', amount: 1000 }),
    ];
    expect(sumReservedSends(history)).toBe(150);
  });

  it('returns 0 for an empty list', () => {
    expect(sumReservedSends([])).toBe(0);
  });
});
