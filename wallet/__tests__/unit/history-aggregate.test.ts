import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '@cashu/coco-core';

import {
  inFlightReceiveToHistoryEntry,
  isPendingPaymentRequestEntry,
  listPendingPaymentRequestEntries,
  mergeTransactionSources,
  PENDING_PAYMENT_REQUEST_MAX_AGE_MS,
  pendingPaymentRequestToHistoryEntry,
  sameTransactionList,
} from '../../src/history';
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

  it('breaks equal-createdAt ties by id DESC, matching coco compareHistoryEntries', () => {
    // coco returns [b, a] for equal timestamps (id DESC). The merge sort must
    // preserve that order even when an in-flight receive triggers a re-sort.
    const cocoHistory = [
      entry({ id: 'send:b', type: 'send', createdAt: 100 } as never),
      entry({ id: 'send:a', type: 'send', createdAt: 100 } as never),
    ];
    const receiveEntries = [
      entry({ id: 'receive-op1', type: 'receive', operationId: 'op1', createdAt: 100 } as never),
    ];
    const merged = mergeTransactionSources({ cocoHistory, receiveEntries });
    expect(merged.map((e) => e.id)).toEqual(['send:b', 'send:a', 'receive-op1']);
  });
});

describe('pendingPaymentRequestToHistoryEntry', () => {
  const op = {
    id: 'req-op-1',
    encodedRequest: 'creqAexample',
    state: 'active' as const,
    transport: 'nostr' as const,
    amount: 100,
    unit: 'sat',
    mints: ['https://mint1.example.com', 'https://mint2.example.com'],
    singleUse: true,
    createdAt: 500,
    updatedAt: 500,
  };

  it('synthesizes a pending receive-typed row keyed by the request op id', () => {
    const e = pendingPaymentRequestToHistoryEntry(op as never);
    expect(e.id).toBe('pr-req-op-1');
    expect(e.type).toBe('receive');
    expect((e as { operationId?: string }).operationId).toBe('req-op-1');
    expect((e as { state?: string }).state).toBe('executing'); // buckets pending
    expect(e.mintUrl).toBe('https://mint1.example.com');
  });

  it('carries everything the detail route needs in metadata', () => {
    const e = pendingPaymentRequestToHistoryEntry(op as never);
    expect(e.metadata).toMatchObject({
      operationId: 'req-op-1',
      source: 'payment-request',
      paymentRequestPending: '1',
      encodedRequest: 'creqAexample',
      requestAmount: '100',
      requestUnit: 'sat',
      requestMints: JSON.stringify(op.mints),
      singleUse: '1',
    });
    expect(isPendingPaymentRequestEntry(e)).toBe(true);
  });
});

describe('listPendingPaymentRequestEntries — 24h display cutoff', () => {
  const NOW = 1_800_000_000_000; // fixed epoch ms
  const requestOp = (id: string, createdAt: number) => ({
    id,
    encodedRequest: 'creqAexample',
    state: 'active' as const,
    transport: 'nostr' as const,
    amount: 100,
    unit: 'sat',
    mints: ['https://mint1.example.com'],
    singleUse: true,
    createdAt,
    updatedAt: createdAt,
  });
  const managerWith = (ops: unknown[]) =>
    ({
      paymentRequests: { incoming: { list: async () => ops } },
    }) as never;

  it('shows requests created within the last 24h and hides older ones', async () => {
    const fresh = requestOp('fresh', NOW - PENDING_PAYMENT_REQUEST_MAX_AGE_MS + 1);
    const boundary = requestOp('boundary', NOW - PENDING_PAYMENT_REQUEST_MAX_AGE_MS);
    const stale = requestOp('stale', NOW - PENDING_PAYMENT_REQUEST_MAX_AGE_MS - 1);

    const entries = await listPendingPaymentRequestEntries(
      managerWith([fresh, boundary, stale]),
      NOW,
    );
    expect(entries.map((e) => e.id)).toEqual(['pr-fresh', 'pr-boundary']);
  });

  it('returns nothing when every active request is stale', async () => {
    const stale = requestOp('stale', NOW - 2 * PENDING_PAYMENT_REQUEST_MAX_AGE_MS);
    expect(await listPendingPaymentRequestEntries(managerWith([stale]), NOW)).toEqual([]);
  });
});

describe('inFlightReceiveToHistoryEntry — payment-request source', () => {
  it('carries requestOperationId so the pending request row dedupes offline', () => {
    const e = inFlightReceiveToHistoryEntry({
      id: 'recv-op',
      mintUrl: 'https://mint1.example.com',
      unit: 'sat',
      amount: 21,
      createdAt: 300,
      updatedAt: 300,
      source: { type: 'payment-request', requestOperationId: 'req-1' },
    } as never);
    expect((e.metadata as Record<string, string>).requestOperationId).toBe('req-1');
  });

  it('omits requestOperationId for a non-payment-request receive', () => {
    const e = inFlightReceiveToHistoryEntry({
      id: 'recv-op',
      mintUrl: 'https://mint1.example.com',
      unit: 'sat',
      amount: 21,
      createdAt: 300,
      updatedAt: 300,
    } as never);
    expect('requestOperationId' in (e.metadata as Record<string, string>)).toBe(false);
  });
});

describe('mergeTransactionSources — pending payment requests', () => {
  const pendingRequest = pendingPaymentRequestToHistoryEntry({
    id: 'req-1',
    encodedRequest: 'creqAx',
    state: 'active',
    transport: 'nostr',
    amount: 21,
    unit: 'sat',
    mints: ['https://mint1.example.com'],
    singleUse: true,
    createdAt: 300,
    updatedAt: 300,
  } as never);

  it('surfaces an active pending request as a row', () => {
    const cocoHistory = [entry({ id: 'a', type: 'send', createdAt: 100 } as never)];
    const merged = mergeTransactionSources({
      cocoHistory,
      receiveEntries: [],
      pendingRequestEntries: [pendingRequest],
    });
    expect(merged.map((e) => e.id)).toEqual(['pr-req-1', 'a']);
  });

  it('drops the pending request once a child receive citing it appears (handoff)', () => {
    // coco keeps the request `active` until the child receive finalizes, so
    // both can momentarily coexist; the receive (metadata.requestOperationId)
    // must supersede the awaiting-payment stub.
    const cocoHistory = [
      entry({
        id: 'recv-final',
        type: 'receive',
        operationId: 'recv-op',
        createdAt: 310,
        metadata: { requestOperationId: 'req-1' },
      } as never),
    ];
    const merged = mergeTransactionSources({
      cocoHistory,
      receiveEntries: [],
      pendingRequestEntries: [pendingRequest],
    });
    expect(merged.map((e) => e.id)).toEqual(['recv-final']);
  });

  it('also dedupes against an in-flight (executing) child receive', () => {
    const receiveEntries = [
      entry({
        id: 'receive-recv-op',
        type: 'receive',
        operationId: 'recv-op',
        createdAt: 305,
        state: 'executing',
        metadata: { requestOperationId: 'req-1' },
      } as never),
    ];
    const merged = mergeTransactionSources({
      cocoHistory: [],
      receiveEntries,
      pendingRequestEntries: [pendingRequest],
    });
    expect(merged.map((e) => e.id)).toEqual(['receive-recv-op']);
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
