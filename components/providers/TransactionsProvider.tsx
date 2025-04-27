import { useEffect, useState, createContext, useContext, useRef } from 'react';
import { useSelector } from 'react-redux';
import { store } from 'helper/redux/store';
import { CashuMint, CashuWallet, getDecodedToken, injectWebSocketImpl } from '@cashu/cashu-ts';
import { memoizedGetTransactions, updateTransaction } from 'helper/redux/cashu';
import { showMessage } from 'helper/popup/popups';

const TransactionContext = createContext(null);

export const useTransactions = () => {
  const context = useContext(TransactionContext);
  if (!context) {
    throw new Error('useTransactions must be used within a TransactionProvider');
  }
  return context;
};

export const TransactionProvider = ({ children }) => {
  const transactions = useSelector(memoizedGetTransactions({ id: 0 }));
  // Use a ref to hold the Map object to prevent unnecessary re-renders
  const activeConnectionsRef = useRef(new Map());
  const [activeConnections, setActiveConnections] = useState([]);

  const addConnection = (id: string, connection: any) => {
    activeConnectionsRef.current.set(id, {
      unsub: connection.unsub,
      timestamp: Date.now(),
    });
    setActiveConnections([
      ...Array.from(activeConnectionsRef.current.entries()).map(([id, connection]) => ({
        id,
        since: connection.timestamp,
      })),
      { id, since: Date.now() },
    ]);
  };

  const removeConnection = (id: string) => {
    activeConnectionsRef.current.delete(id);
    setActiveConnections([
      ...Array.from(activeConnectionsRef.current.entries()).map(([id, connection]) => ({
        id,
        since: connection.timestamp,
      })),
    ]);
  };

  // Helper function to update transaction status in Redux
  const updateTransactionStatus = (
    { token, type, transactionType, request },
    status,
    additionalData = {}
  ) => {
    store.dispatch(
      updateTransaction({
        profileId: 0,
        matcher: (tx) => {
          return type
            ? tx.token === token && tx.type === type && tx.transactionType === transactionType
            : tx.request === request && tx.type === type && tx.transactionType === transactionType;
        },
        updateFn: (tx) => ({
          ...tx,
          status,
          ...additionalData,
        }),
      })
    );
  };

  // Clean up connections when component unmounts
  useEffect(() => {
    return () => {
      // Close all active connections when provider unmounts
      for (const [id, connection] of activeConnectionsRef.current.entries()) {
        if (connection && connection.unsub) {
          connection.unsub();
          removeConnection(id);
        }
      }
    };
  }, []);

  // Start listening to a transaction
  const listenToTransaction = async (transaction) => {
    const { type, token, transactionType, mintQuote, request } = transaction;

    const id =
      type === 'ecash'
        ? type + '_' + token + '_' + transactionType
        : type + '_' + request + '_' + transactionType;

    // Skip if already listening
    if (activeConnectionsRef.current.has(id)) {
      return;
    }

    try {
      const mintUrl = transaction.mintUrl;
      const mint = new CashuMint(mintUrl);
      const wallet = new CashuWallet(mint);
      await wallet.loadMint();

      injectWebSocketImpl(WebSocket);

      let unsub;

      // Choose the appropriate listener based on transaction type
      if (type === 'ecash') {
        const decodedToken = getDecodedToken(token);
        // Make sure there are proofs to listen to
        if (decodedToken.proofs && decodedToken.proofs.length > 0) {
          unsub = await wallet.onProofStateUpdates(
            decodedToken.proofs,
            async (update) => {
              const isPaid = update.state === 'SPENT';

              // If paid, unsubscribe from updates
              if (isPaid) {
                // Update transaction status to paid
                const amount = decodedToken.proofs.reduce((acc, proof) => acc + proof.amount, 0);
                showMessage('funds_sent', { amount: amount, unit: decodedToken.unit });

                updateTransactionStatus(
                  {
                    token,
                    type,
                    transactionType,
                  },
                  'paid',
                  { paid: true, completedAt: Date.now() }
                );

                // Clean up the connection
                if (unsub) {
                  unsub();
                  // Remove transaction from active connections
                  removeConnection(id);
                }
              }
            },
            async (error) => {
              console.error(`Error in transaction ${id}:`, error);

              // Update transaction status to error
              updateTransactionStatus(
                {
                  token,
                  type,
                  transactionType,
                },
                'error',
                { error: error.message }
              );

              // Clean up the connection
              if (unsub) {
                unsub();
                // Remove transaction from active connections
                removeConnection(id);
              }
            }
          );
        }
      } else if (type === 'lightning') {
        console.log(108927398723, mintQuote, transaction);
        unsub = await wallet.onMintQuoteUpdates(
          [mintQuote.quote],
          (update) => {
            const isPaid = update.state === 'PAID';

            if (isPaid) {
              // Update transaction status to paid
              updateTransactionStatus(
                {
                  request,
                  type,
                  transactionType,
                },
                'paid',
                { paid: true, completedAt: Date.now() }
              );
              // Clean up the connection
              if (unsub) {
                unsub();
                // Remove transaction from active connections
                removeConnection(id);
              }
            }
          },
          (error) => {
            console.error(`Error in transaction ${id}:`, error);
            // Update transaction status to error
            updateTransactionStatus(
              {
                request,
                type,
                transactionType,
              },
              'error',
              { error: error.message }
            );
            // Clean up the connection
            if (unsub) {
              unsub();
              // Remove transaction from active connections
              removeConnection(id);
            }
          }
        );
      }

      // Store the unsubscribe function
      if (unsub) {
        addConnection(id, { unsub });
      }
    } catch (error) {
      console.error(`Error setting up listener for transaction ${id}:`, error);
      // Set that transaction is not listening with error status
      updateTransactionStatus(
        {
          type,
          transactionType,
          request,
        },
        'error',
        { error: error.message }
      );
    }
  };

  // Stop listening to a transaction
  const stopListening = (id) => {
    const connection = activeConnectionsRef.current.get(id);
    if (connection && connection.unsub) {
      connection.unsub();
      // Set that transaction is not listening
      updateTransactionStatus(id, 'inactive');
      // Remove transaction from active connections
      activeConnectionsRef.current.delete(id);
    }
  };

  const getActiveConnections = () =>
    Array.from(activeConnectionsRef.current.entries()).map(([id, connection]) => ({
      id,
      since: connection.timestamp,
    }));

  const value = {
    transactions,
    listenToTransaction,
    stopListening,
    getActiveConnections,
    activeConnections,
  };

  return <TransactionContext.Provider value={value}>{children}</TransactionContext.Provider>;
};
