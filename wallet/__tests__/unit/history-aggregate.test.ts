import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '@cashu/coco-core';

import { mergeTransactionSources, sameTransactionList } from '../../src/history';
import {
  normalizeHistoryEntries,
  normalizeHistoryEntryState,
} from '../../src/history/normalize';

function entry(partial: Partial<HistoryEntry> & { id: string; type: string }): HistoryEntry {
  return partial as unknown as HistoryEntry;
}

describe('mergeTransactionSources', () => {
  it('appends the in-flight receive supplement and sorts newest-first', () => {
    const cocoHistory = [entry({ id: 'a', type: 'send', createdAt: 100 } as never)];
    const receiveEntries = [
      entry({ id: 'r1', type: 'receive', operationId: 'op1', createdAt: 200 } as never),
    ];

    const merged = mergeTransactionSources({ cocoHistory, receiveEntries });
    expect(merged.map((e) => e.id)).toEqual(['r1', 'a']);
  });

  it('keeps a projected melt exactly once (no supplement — coco v2 projects melts)', () => {
    const cocoHistory = [
      entry({ id: 'melt:op1', type: 'melt', quoteId: 'q1', createdAt: 100 } as never),
    ];
    const merged = mergeTransactionSources({ cocoHistory, receiveEntries: [] });
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('melt:op1');
  });

  it('dedupes an in-flight receive once it finalizes in coco history (by operationId)', () => {
    const cocoHistory = [
      entry({ id: 'final', type: 'receive', operationId: 'op1', createdAt: 100 } as never),
    ];
    const receiveEntries = [
      entry({ id: 'receive-op1', type: 'receive', operationId: 'op1', createdAt: 100 } as never),
    ];
    const merged = mergeTransactionSources({ cocoHistory, receiveEntries });
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('final');
  });

  it('returns a copy of coco history when there are no supplements', () => {
    const cocoHistory = [entry({ id: 'a', type: 'send', createdAt: 1 } as never)];
    const merged = mergeTransactionSources({ cocoHistory, receiveEntries: [] });
    expect(merged).toEqual(cocoHistory);
    expect(merged).not.toBe(cocoHistory);
  });
});

describe('normalizeHistoryEntryState', () => {
  it.each([
    // v2 operation-projected states → legacy vocabulary
    ['mint', 'pending', 'UNPAID'],
    ['mint', 'executing', 'PAID'],
    ['mint', 'finalized', 'ISSUED'],
    ['mint', 'failed', 'UNPAID'],
    ['melt', 'prepared', 'UNPAID'],
    ['melt', 'pending', 'PENDING'],
    ['melt', 'finalized', 'PAID'],
    ['melt', 'rolled_back', 'rolledBack'],
    ['send', 'rolled_back', 'rolledBack'],
    ['receive', 'rolled_back', 'rolledBack'],
    // legacy states pass through unchanged
    ['mint', 'UNPAID', 'UNPAID'],
    ['mint', 'ISSUED', 'ISSUED'],
    ['melt', 'PAID', 'PAID'],
    ['send', 'rolledBack', 'rolledBack'],
    ['send', 'pending', 'pending'],
    ['receive', 'finalized', 'finalized'],
  ])('%s %s → %s', (type, state, expected) => {
    const normalized = normalizeHistoryEntryState(entry({ id: 'x', type, state } as never));
    expect((normalized as { state?: string }).state).toBe(expected);
  });

  it('keeps the entry reference when nothing changes', () => {
    const e = entry({ id: 'x', type: 'send', state: 'pending' } as never);
    expect(normalizeHistoryEntryState(e)).toBe(e);
  });
});

describe('normalizeHistoryEntries', () => {
  it('keeps the array reference when no entry changes', () => {
    const list = [entry({ id: 'a', type: 'send', state: 'pending' } as never)];
    expect(normalizeHistoryEntries(list)).toBe(list);
  });

  it('returns a new array when any entry normalizes', () => {
    const list = [entry({ id: 'a', type: 'send', state: 'rolled_back' } as never)];
    const out = normalizeHistoryEntries(list);
    expect(out).not.toBe(list);
    expect((out[0] as { state?: string }).state).toBe('rolledBack');
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
