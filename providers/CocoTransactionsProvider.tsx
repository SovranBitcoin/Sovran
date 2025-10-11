import React, { useEffect, createContext, useContext } from 'react';
import { useManager, usePaginatedHistory } from 'coco-cashu-react';
import { HistoryEntry } from 'coco-cashu-core';

interface TransactionContextType {
  history: HistoryEntry[];
  loadMore: () => Promise<void>;
  goToPage: (page: number) => Promise<void>;
  refresh: () => Promise<void>;
  hasMore: boolean;
  isFetching: boolean;
}

const TransactionContext = createContext<TransactionContextType | null>(null);

export const useTransactions = () => {
  const context = useContext(TransactionContext);
  if (!context) {
    throw new Error('useTransactions must be used within a CocoTransactionsProvider');
  }
  return context;
};

interface CocoTransactionsProviderProps {
  children: React.ReactElement;
}

export const CocoTransactionsProvider = ({ children }: CocoTransactionsProviderProps) => {
  const manager = useManager();
  const { history, loadMore, goToPage, refresh, hasMore, isFetching } = usePaginatedHistory();

  // Set up event listeners for real-time updates
  useEffect(() => {
    if (!manager) return;

    // Listen for mint quote state changes (Lightning transactions)
    const unsubscribeMintQuotes = manager.on('mint-quote:state-changed', (payload) => {
      // Coco automatically updates its internal state
      // Just refresh the history to get the latest data
      refresh();
    });

    // Listen for mint quote redemption (when proofs are minted)
    const unsubscribeMintQuoteRedeemed = manager.on('mint-quote:redeemed', (payload) => {
      refresh();
    });

    // Listen for proof state changes (Ecash transactions)
    const unsubscribeProofs = manager.on('proofs:state-changed', (payload) => {
      refresh();
    });

    // Listen for melt quote payments (Lightning sends)
    const unsubscribeMeltQuotes = manager.on('melt-quote:paid', (payload) => {
      refresh();
    });

    // Listen for general history updates
    const unsubscribeHistory = manager.on('history:updated', () => {
      refresh();
    });

    return () => {
      unsubscribeMintQuotes();
      unsubscribeMintQuoteRedeemed();
      unsubscribeProofs();
      unsubscribeMeltQuotes();
      unsubscribeHistory();
    };
  }, [manager, refresh]);

  const value: TransactionContextType = {
    history,
    loadMore,
    goToPage,
    refresh,
    hasMore,
    isFetching,
  };

  return <TransactionContext.Provider value={value}>{children}</TransactionContext.Provider>;
};
