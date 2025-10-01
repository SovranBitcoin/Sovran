import { usePaginatedHistory } from 'coco-cashu-react';
import { adaptCocoHistoryToTransaction, CocoTransactionAdapter } from 'helper/coco/typeAdapters';

/**
 * Hook that provides Coco history entries adapted to legacy TransactionData format
 * This bridges the gap between Coco's HistoryEntry types and existing component expectations
 */
export function useAdaptedTransactions() {
  const { history, loadMore, goToPage, refresh, hasMore, isFetching } = usePaginatedHistory();

  // Adapt all history entries to the legacy format
  const adaptedTransactions: CocoTransactionAdapter[] = history.map(adaptCocoHistoryToTransaction);

  return {
    transactions: adaptedTransactions,
    loadMore,
    goToPage,
    refresh,
    hasMore,
    isFetching,
  };
}
