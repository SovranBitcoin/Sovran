/**
 * Pure event handler for the split-bill payment reconciler. Extracted so
 * the branching can be exercised by a unit test without React, NDK, or
 * coco mocks. The hook in `useSplitBillOrchestrator.ts` calls this on
 * each Colada `history.updated` bus event.
 *
 * Returns the action taken so callers (and tests) can assert on the
 * outcome; the live hook just discards the value.
 */

import { isMintQuotePaymentObserved } from 'colada';

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
  if (entry.type !== 'mint') return 'ignored';
  const quoteId = entry.quoteId;
  if (!quoteId) return 'ignored';
  const ref = store.quoteIdToSplitBill[quoteId];
  if (!ref) return 'ignored';
  if (isMintQuotePaymentObserved(entry)) {
    store.markPaymentPaidByQuoteId(quoteId);
    return 'paid';
  }
  if (entry.state === 'EXPIRED') {
    store.markPaymentExpiredByQuoteId(quoteId);
    return 'expired';
  }
  return 'ignored';
}
