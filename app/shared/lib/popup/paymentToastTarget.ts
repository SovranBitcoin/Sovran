/**
 * Opening a toast's transaction: find the saved history entry the toast is
 * about and hand it to the same navigation a history row uses. A toast whose
 * entry is not saved yet opens nothing — it never builds an entry of its own.
 */

import type { HistoryEntry } from '@cashu/coco-core';

import { CocoManager } from '@/shared/lib/cashu/manager';
import { popupLog } from '@/shared/lib/logger';
import { navigateToTransactionDetail } from '@/shared/lib/nav/transactionDetailRoutes';
import type { PaymentToastTarget } from '@/shared/stores/runtime/paymentStatusStore';

/** How far back a toast looks for its entry: it is about a payment of just now. */
const HISTORY_WINDOW = 100;

const field = (entry: HistoryEntry, name: string): unknown =>
  (entry as unknown as Record<string, unknown>)[name];

/** Whether `entry` is the transaction `target` names, at `mintUrl`. */
export function isToastTarget(
  entry: HistoryEntry,
  target: PaymentToastTarget,
  mintUrl: string
): boolean {
  if (entry.type !== target.type || entry.mintUrl !== mintUrl) return false;
  switch (target.type) {
    case 'mint':
    case 'melt':
      return field(entry, 'quoteId') === target.quoteId;
    case 'send':
      return field(entry, 'operationId') === target.operationId || entry.id === target.operationId;
    case 'receive':
      return (
        (target.entryId !== undefined && entry.id === target.entryId) ||
        (target.operationId !== undefined &&
          (field(entry, 'operationId') === target.operationId || entry.id === target.operationId))
      );
  }
}

/**
 * Open the transaction a toast is about, as a history view. Resolves to
 * whether a screen was opened.
 */
export async function openToastTransaction(
  target: PaymentToastTarget,
  mintUrl: string
): Promise<boolean> {
  if (!CocoManager.isInitialized()) return false;
  try {
    const history = await CocoManager.getInstance().history.getPaginatedHistory(0, HISTORY_WINDOW);
    const entry = history.find((candidate) => isToastTarget(candidate, target, mintUrl));
    if (!entry) {
      popupLog.info('popup.open_transaction.not_in_history', { type: target.type });
      return false;
    }
    navigateToTransactionDetail(entry, 'toast');
    return true;
  } catch (error) {
    popupLog.warn('popup.open_transaction_failed', { error });
    return false;
  }
}
