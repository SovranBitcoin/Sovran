import { describe, expect, it } from 'vitest';
import type { HistoryEntry, MeltHistoryEntry, MeltOperation } from '@cashu/coco-core';

import {
  meltOpToHistoryEntry,
  mergeTransactionSources,
  sameTransactionList,
} from '../../src/history';

function entry(partial: Partial<HistoryEntry> & { id: string; type: string }): HistoryEntry {
  return partial as unknown as HistoryEntry;
}

describe('meltOpToHistoryEntry', () => {
  it('maps a finalized melt op to a PAID melt entry', () => {
    const op = {
      id: 'melt-1',
      state: 'finalized',
      mintUrl: 'https://mint.example',
      createdAt: 10,
      quoteId: 'q1',
      amount: 500,
    } as unknown as MeltOperation;
    expect(meltOpToHistoryEntry(op)).toMatchObject({
      id: 'melt-1',
      type: 'melt',
      quoteId: 'q1',
      amount: 500,
      state: 'PAID',
    });
  });

  it('returns null for an op without quoteId/amount', () => {
    const op = { id: 'melt-2', state: 'init', mintUrl: 'm', createdAt: 1 } as unknown as MeltOperation;
    expect(meltOpToHistoryEntry(op)).toBeNull();
  });
});

describe('mergeTransactionSources', () => {
  it('appends supplements and sorts newest-first', () => {
    const cocoHistory = [entry({ id: 'a', type: 'send', createdAt: 100 } as never)];
    const meltEntries = [
      { id: 'm1', type: 'melt', quoteId: 'q1', createdAt: 300 } as unknown as MeltHistoryEntry,
    ];
    const receiveEntries = [entry({ id: 'r1', type: 'receive', operationId: 'op1', createdAt: 200 } as never)];

    const merged = mergeTransactionSources({ cocoHistory, meltEntries, receiveEntries });
    expect(merged.map((e) => e.id)).toEqual(['m1', 'r1', 'a']);
  });

  it('dedupes a melt already present in coco history by quoteId', () => {
    const cocoHistory = [entry({ id: 'h-melt', type: 'melt', quoteId: 'q1', createdAt: 100 } as never)];
    const meltEntries = [
      { id: 'op-melt', type: 'melt', quoteId: 'q1', createdAt: 100 } as unknown as MeltHistoryEntry,
    ];
    const merged = mergeTransactionSources({ cocoHistory, meltEntries, receiveEntries: [] });
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('h-melt');
  });

  it('dedupes an in-flight receive once it finalizes in coco history (by operationId)', () => {
    const cocoHistory = [
      entry({ id: 'final', type: 'receive', operationId: 'op1', createdAt: 100 } as never),
    ];
    const receiveEntries = [
      entry({ id: 'receive-op1', type: 'receive', operationId: 'op1', createdAt: 100 } as never),
    ];
    const merged = mergeTransactionSources({ cocoHistory, meltEntries: [], receiveEntries });
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('final');
  });

  it('returns a copy of coco history when there are no supplements', () => {
    const cocoHistory = [entry({ id: 'a', type: 'send', createdAt: 1 } as never)];
    const merged = mergeTransactionSources({ cocoHistory, meltEntries: [], receiveEntries: [] });
    expect(merged).toEqual(cocoHistory);
    expect(merged).not.toBe(cocoHistory);
  });
});

describe('sameTransactionList', () => {
  it('is true for same ids and states', () => {
    const a = [entry({ id: '1', type: 'send', state: 'pending' } as never)];
    const b = [entry({ id: '1', type: 'send', state: 'pending' } as never)];
    expect(sameTransactionList(a, b)).toBe(true);
  });

  it('is false when a state changes', () => {
    const a = [entry({ id: '1', type: 'send', state: 'pending' } as never)];
    const b = [entry({ id: '1', type: 'send', state: 'finalized' } as never)];
    expect(sameTransactionList(a, b)).toBe(false);
  });

  it('is false when length differs', () => {
    const a = [entry({ id: '1', type: 'send' } as never)];
    expect(sameTransactionList(a, [])).toBe(false);
  });
});
