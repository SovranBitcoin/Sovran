import { useEffect, useState, createContext, useContext, useRef } from 'react';
import { useSelector } from 'react-redux';
import { store } from 'helper/redux/store';
import { CashuMint, CashuWallet, getDecodedToken, injectWebSocketImpl } from '@cashu/cashu-ts';
import {
  appendProofsV2,
  increaseCounterV2,
  memoizedGetCounterV2,
  memoizedGetTransactions,
  updateTransaction,
} from 'helper/redux/cashu';
import { showMessage } from 'helper/popup/popups';
import { publishWalletEvent } from 'helper/nostr/cashu';
import { getWallet, updateStateAfterPayment } from 'components/cashu';

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
    { token, type, transactionType, request, quote },
    status,
    additionalData = {}
  ) => {
    store.dispatch(
      updateTransaction({
        profileId: 0,
        matcher: (tx) => {
          return type === 'ecash'
            ? tx.token === token && tx.type === type && tx.transactionType === transactionType
            : tx.request === request &&
                tx.type === type &&
                tx.transactionType === transactionType &&
                tx.mintQuote?.quote === quote;
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

    if (transaction.paid) {
      return;
    }

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

      injectWebSocketImpl(WebSocket);

      let unsub;

      // Choose the appropriate listener based on transaction type
      if (type === 'ecash') {
        const decodedToken = getDecodedToken(token);
        // Make sure there are proofs to listen to
        unsub = await wallet.onProofStateUpdates(
          decodedToken.proofs,
          (update) => {
            const isPaid = update.state === 'SPENT';

            // If paid, unsubscribe from updates
            if (isPaid) {
              // Update transaction status to paid
              showMessage('funds_sent', { amount: transaction.amount, unit: transaction.unit });

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
        if (unsub) {
          addConnection(id, { unsub });
        }
      } else if (type === 'lightning') {
        unsub = await wallet.onMintQuoteUpdates(
          [mintQuote.quote],
          async (update) => {
            const isPaid = update.state === 'PAID';

            if (isPaid) {
              // todo: i want to make a provider for wallets/mints
              const w = await getWallet({
                mintUrl,
                unit: transaction.unit,
              });

              const counter = memoizedGetCounterV2({
                profileId: store.getState().nostr.currentProfile.id,
                mintUrl,
                keysetId: w.keysetId,
              })(store.getState());

              const proofs = await w.mintProofs(transaction.amount, mintQuote.quote, {
                counter,
                keysetId: w.keysetId,
              });

              store.dispatch(
                increaseCounterV2({
                  profileId: store.getState().nostr.currentProfile.id,
                  mintUrl,
                  keysetId: w.keysetId,
                  amount: proofs.length,
                })
              );

              await store.dispatch(
                appendProofsV2({
                  profileId: store.getState().nostr.currentProfile.id,
                  mintUrl,
                  proofs: proofs,
                })
              );

              publishWalletEvent([
                ...new Set([
                  ...store
                    .getState()
                    .cashu?.profiles?.[
                      store.getState().nostr.currentProfile.id
                    ]?.transactions.map((t) => t.mintUrl),
                  mintUrl,
                ]),
              ]);

              // Update transaction status to paid
              showMessage('funds_sent', { amount: transaction.amount, unit: transaction.unit });

              updateTransactionStatus(
                {
                  request,
                  type,
                  transactionType,
                  quote: mintQuote.quote,
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
        if (unsub) {
          addConnection(id, { unsub });
        }
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
