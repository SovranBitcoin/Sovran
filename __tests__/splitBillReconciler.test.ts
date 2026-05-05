import { reconcileSplitBillHistoryUpdate } from '@/features/splitBill/lib/reconcileSplitBillHistoryUpdate';

function makeStore(quoteIdToSplitBill: Record<string, { groupId: string; participantId: string }>) {
  const calls: { fn: 'paid' | 'expired'; quoteId: string }[] = [];
  return {
    quoteIdToSplitBill,
    markPaymentPaidByQuoteId: (quoteId: string) => calls.push({ fn: 'paid', quoteId }),
    markPaymentExpiredByQuoteId: (quoteId: string) => calls.push({ fn: 'expired', quoteId }),
    calls,
  };
}

describe('reconcileSplitBillHistoryUpdate', () => {
  test('flips a tracked quote to paid on PAID', () => {
    const store = makeStore({ q1: { groupId: 'g1', participantId: 'p1' } });
    const outcome = reconcileSplitBillHistoryUpdate(
      { type: 'mint', quoteId: 'q1', state: 'PAID' },
      store
    );
    expect(outcome).toBe('paid');
    expect(store.calls).toEqual([{ fn: 'paid', quoteId: 'q1' }]);
  });

  test('flips a tracked quote to paid on ISSUED (treated as terminal)', () => {
    const store = makeStore({ q1: { groupId: 'g1', participantId: 'p1' } });
    expect(
      reconcileSplitBillHistoryUpdate({ type: 'mint', quoteId: 'q1', state: 'ISSUED' }, store)
    ).toBe('paid');
  });

  test('flips a tracked quote to expired on EXPIRED', () => {
    const store = makeStore({ q1: { groupId: 'g1', participantId: 'p1' } });
    const outcome = reconcileSplitBillHistoryUpdate(
      { type: 'mint', quoteId: 'q1', state: 'EXPIRED' },
      store
    );
    expect(outcome).toBe('expired');
    expect(store.calls).toEqual([{ fn: 'expired', quoteId: 'q1' }]);
  });

  test('ignores entries for untracked quoteIds (other mints / unrelated history)', () => {
    const store = makeStore({ q1: { groupId: 'g1', participantId: 'p1' } });
    const outcome = reconcileSplitBillHistoryUpdate(
      { type: 'mint', quoteId: 'unknown', state: 'PAID' },
      store
    );
    expect(outcome).toBe('ignored');
    expect(store.calls).toEqual([]);
  });

  test('ignores non-mint entries (melt, send, receive)', () => {
    const store = makeStore({ q1: { groupId: 'g1', participantId: 'p1' } });
    expect(
      reconcileSplitBillHistoryUpdate({ type: 'melt', quoteId: 'q1', state: 'PAID' }, store)
    ).toBe('ignored');
    expect(store.calls).toEqual([]);
  });

  test('ignores intermediate states (UNPAID stays pending until terminal)', () => {
    const store = makeStore({ q1: { groupId: 'g1', participantId: 'p1' } });
    expect(
      reconcileSplitBillHistoryUpdate({ type: 'mint', quoteId: 'q1', state: 'UNPAID' }, store)
    ).toBe('ignored');
    expect(store.calls).toEqual([]);
  });

  test('ignores entries with no quoteId', () => {
    const store = makeStore({ q1: { groupId: 'g1', participantId: 'p1' } });
    expect(reconcileSplitBillHistoryUpdate({ type: 'mint', state: 'PAID' }, store)).toBe('ignored');
  });
});
