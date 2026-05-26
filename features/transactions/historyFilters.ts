import type { HistoryEntry } from '@cashu/coco-core';

import { isCancellablePendingEcash } from '@/shared/lib/cashu/utils';
import { getOnchainMintAddress } from '@/shared/lib/cashu/onchainMint';

export type TransactionPaymentType = 'all' | 'lightning' | 'ecash' | 'onchain';
export type TransactionDirection = 'all' | 'incoming' | 'outgoing';

export function isOnchainHistoryEntry(historyEntry: HistoryEntry): boolean {
  return !!getOnchainMintAddress(historyEntry);
}

export function matchesTransactionPaymentType(
  historyEntry: HistoryEntry,
  paymentType: TransactionPaymentType
): boolean {
  if (paymentType === 'all') return true;

  if (paymentType === 'onchain') {
    return isOnchainHistoryEntry(historyEntry);
  }

  if (paymentType === 'lightning') {
    if (historyEntry.type === 'melt') return true;
    return historyEntry.type === 'mint' && !isOnchainHistoryEntry(historyEntry);
  }

  return historyEntry.type === 'send' || historyEntry.type === 'receive';
}

export function matchesTransactionDirection(
  historyEntry: HistoryEntry,
  direction: TransactionDirection
): boolean {
  if (direction === 'all') return true;
  if (direction === 'incoming') {
    return historyEntry.type === 'mint' || historyEntry.type === 'receive';
  }
  return historyEntry.type === 'send' || historyEntry.type === 'melt';
}

export function matchesTransactionFilters(
  historyEntry: HistoryEntry,
  {
    paymentType,
    direction,
  }: {
    paymentType: TransactionPaymentType;
    direction: TransactionDirection;
  }
): boolean {
  return (
    matchesTransactionPaymentType(historyEntry, paymentType) &&
    matchesTransactionDirection(historyEntry, direction)
  );
}

export function isPendingTransaction(
  historyEntry: HistoryEntry,
  options: { isCollapsingGhost?: boolean } = {}
): boolean {
  if (options.isCollapsingGhost) return true;

  if (historyEntry.type === 'mint') {
    const state = String(historyEntry.state).toLowerCase();
    if (isOnchainHistoryEntry(historyEntry)) {
      return state === 'pending' || state === 'executing' || state === 'unpaid';
    }
    return state === 'unpaid';
  }

  if (historyEntry.type === 'melt') {
    return String(historyEntry.state).toLowerCase() === 'unpaid';
  }

  return isCancellablePendingEcash(historyEntry);
}
