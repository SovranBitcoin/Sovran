/**
 * Pure event handler for the split-bill payment reconciler. Extracted so
 * the branching can be exercised by a unit test without React, NDK, or
 * coco mocks. The hook in `useSplitBillOrchestrator.ts` calls this on
 * each Colada `history.updated` bus event.
 *
 * Returns the action taken so callers (and tests) can assert on the
 * outcome; the live hook just discards the value.
 */

import { isMintQuotePaymentObserved } from '@sovranbitcoin/colada';

import { cashuLog } from '@/shared/lib/logger';

interface ReconcilerStore {
  quoteIdToSplitBill: Record<string, { groupId: string; participantId: string }>;
  markPaymentPaidByQuoteId: (quoteId: string) => void;
  markPaymentExpiredByQuoteId: (quoteId: string) => void;
}

interface ReconcilerEntry {
  type: string;
  quoteId?: string;
  state?: string;
}

type ReconcilerOutcome = 'paid' | 'expired' | 'ignored';

export function reconcileSplitBillHistoryUpdate(
  entry: ReconcilerEntry,
  store: ReconcilerStore
): ReconcilerOutcome {
  if (entry.type !== 'mint') {
    cashuLog.debug('split_bill.history_reconcile.result', {
      outcome: 'ignored',
      reason: 'wrong-type',
      type: entry.type,
      state: entry.state ?? null,
    });
    return 'ignored';
  }
  const quoteId = entry.quoteId;
  if (!quoteId) {
    cashuLog.debug('split_bill.history_reconcile.result', {
      outcome: 'ignored',
      reason: 'missing-quote-id',
      type: entry.type,
      state: entry.state ?? null,
    });
    return 'ignored';
  }
  const ref = store.quoteIdToSplitBill[quoteId];
  if (!ref) {
    cashuLog.debug('split_bill.history_reconcile.result', {
      outcome: 'ignored',
      reason: 'untracked-quote-id',
      type: entry.type,
      state: entry.state ?? null,
      quoteId,
    });
    return 'ignored';
  }
  if (isMintQuotePaymentObserved(entry)) {
    store.markPaymentPaidByQuoteId(quoteId);
    cashuLog.info('split_bill.history_reconcile.result', {
      outcome: 'paid',
      reason: 'payment-observed',
      type: entry.type,
      state: entry.state ?? null,
      quoteId,
      groupId: ref.groupId,
      participantId: ref.participantId,
    });
    return 'paid';
  }
  if (entry.state === 'EXPIRED') {
    store.markPaymentExpiredByQuoteId(quoteId);
    cashuLog.info('split_bill.history_reconcile.result', {
      outcome: 'expired',
      reason: 'expired-state',
      type: entry.type,
      state: entry.state,
      quoteId,
      groupId: ref.groupId,
      participantId: ref.participantId,
    });
    return 'expired';
  }
  cashuLog.debug('split_bill.history_reconcile.result', {
    outcome: 'ignored',
    reason: 'not-observed-or-expired',
    type: entry.type,
    state: entry.state ?? null,
    quoteId,
    groupId: ref.groupId,
    participantId: ref.participantId,
  });
  return 'ignored';
}
