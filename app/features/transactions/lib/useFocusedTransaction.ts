import { useCallback, useId } from 'react';
import { useFocusEffect } from 'expo-router';
import type { HistoryEntry } from '@cashu/coco-core';

import { focusTransaction } from '@/shared/stores/runtime/paymentStatusStore';

/**
 * Every id a payment toast could know this entry by: its own id, its
 * operation and its quote. A preview has none the wallet issued yet; the toast
 * of a payment started from it is matched by the screen itself instead.
 */
export function transactionFocusIds(entry: HistoryEntry | undefined): string[] {
  if (!entry) return [];
  const record = entry as unknown as Record<string, unknown>;
  const metadata = (record.metadata ?? {}) as Record<string, unknown>;
  const ids = [record.id, record.operationId, record.quoteId, metadata.operationId];
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
}

/**
 * While this transaction's screen is in front, no toast is shown for that
 * transaction (or for a payment started from the screen): the screen is
 * already showing it. A screen with no entry (a swap group) claims nothing.
 */
export function useFocusedTransaction(entry: HistoryEntry | undefined): void {
  const screen = useId();
  const idsKey = entry ? transactionFocusIds(entry).join('\n') : null;
  useFocusEffect(
    useCallback(() => {
      if (idsKey === null) return undefined;
      return focusTransaction(screen, idsKey ? idsKey.split('\n') : []);
    }, [idsKey, screen])
  );
}
