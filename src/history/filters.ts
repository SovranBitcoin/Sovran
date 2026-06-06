import type { HistoryEntry, SendHistoryEntry } from '@cashu/coco-core';

import { getHistoryEntryOnchainMintAddress } from './timeline';

export type TransactionPaymentType = 'all' | 'lightning' | 'ecash' | 'onchain';
export type TransactionDirection = 'all' | 'incoming' | 'outgoing';

const CANCELLABLE_SEND_STATES = new Set(['pending', 'prepared']);

export function isCancellablePendingEcash(entry: HistoryEntry): entry is SendHistoryEntry {
  return entry.type === 'send' && CANCELLABLE_SEND_STATES.has((entry as SendHistoryEntry).state);
}

export function isReservedSendHistoryEntry(entry: HistoryEntry): entry is SendHistoryEntry {
  return isCancellablePendingEcash(entry);
}

export function isMintQuotePaymentObserved(
  entry: { state?: unknown; remoteState?: unknown } | null | undefined,
): boolean {
  const state = String(entry?.state ?? '');
  return (
    state === 'executing' ||
    state === 'finalized' ||
    state === 'PAID' ||
    state === 'ISSUED' ||
    entry?.remoteState === 'ISSUED' ||
    entry?.remoteState === 'PAID'
  );
}

export function isMeltQuotePaid(entry: { state?: unknown } | null | undefined): boolean {
  const state = String(entry?.state ?? '');
  return state === 'finalized' || state === 'PAID';
}

export function isMeltQuoteReadyToPay(entry: { state?: unknown } | null | undefined): boolean {
  const state = String(entry?.state ?? '');
  return state === 'prepared' || state === 'UNPAID';
}

export function isReceiveTokenRedeemed(entry: { state?: unknown } | null | undefined): boolean {
  return entry?.state === 'finalized';
}

export function isSendTokenComplete(entry: { state?: unknown } | null | undefined): boolean {
  return entry?.state === 'finalized';
}

export function isSendTokenCancelled(entry: { state?: unknown } | null | undefined): boolean {
  const state = String(entry?.state ?? '');
  return state === 'rolledBack' || state === 'rolled_back';
}

export function isSettledSpendHistoryEntry(historyEntry: HistoryEntry): boolean {
  if (historyEntry.type === 'send') return isSendTokenComplete(historyEntry);
  if (historyEntry.type === 'melt') return isMeltQuotePaid(historyEntry);
  return false;
}

export function isSettledReceiveHistoryEntry(historyEntry: HistoryEntry): boolean {
  if (historyEntry.type === 'receive') return true;
  if (historyEntry.type !== 'mint') return false;
  return String(historyEntry.state) === 'PAID';
}

export function isOnchainHistoryEntry(historyEntry: HistoryEntry): boolean {
  return !!getHistoryEntryOnchainMintAddress(historyEntry);
}

export function matchesTransactionPaymentType(
  historyEntry: HistoryEntry,
  paymentType: TransactionPaymentType,
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
  direction: TransactionDirection,
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
  },
): boolean {
  return (
    matchesTransactionPaymentType(historyEntry, paymentType) &&
    matchesTransactionDirection(historyEntry, direction)
  );
}

export function isPendingTransaction(
  historyEntry: HistoryEntry,
  options: { isCollapsingGhost?: boolean } = {},
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
