import { useEffect, useState, createContext, useContext, useRef, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { store } from 'helper/redux/store';
import {
  getDecodedToken,
  injectWebSocketImpl,
  MintQuoteResponse,
  Proof,
  ProofState,
} from '@cashu/cashu-ts';
import {
  appendProofsV2,
  increaseCounterV2,
  memoizedGetCounterV2,
  memoizedGetTransactions,
  updateTransaction,
} from 'helper/redux/cashu';
import { showMessage } from 'helper/popup/popups';
import { publishWalletEvent } from 'helper/nostr/cashu';
import { getWallet } from 'helper/cashuClient';
import _ from 'lodash';
import { err } from 'neverthrow';
import { toResult } from 'helper/toResult';

const TransactionContext = createContext(null);

export const useAutoListenBatch = (transactions = [], options = { enabled: true }) => {
  const { listenToTransaction, activeConnections } = useTransactions();
  const hasStarted = useRef(false);

  // Determine whether we are already listening
  const isListening = useMemo(() => {
    return (
      transactions.length > 0 &&
      transactions.every((tx) =>
        activeConnections.some((conn) => conn.id.includes(tx.request || tx.token))
      )
    );
  }, [transactions, activeConnections]);

  // Precompute preconditions
  const allUnpaid = transactions.every((tx) => tx.paid !== true);
  const allInactive = transactions.every((tx) => {
    const id = tx.request || tx.token;
    return !activeConnections.some((conn) => conn.id.includes(id));
  });

  // Trigger listen ONLY if enabled is true
  if (
    options.enabled !== false &&
    !hasStarted.current &&
    transactions.length > 0 &&
    allUnpaid &&
    allInactive
  ) {
    listenToTransaction(transactions);
    hasStarted.current = true;
  }

  return {
    isListening,
  };
};

export const useTransactions = () => {
  const context = useContext(TransactionContext);
  if (!context) {
    throw new Error('useTransactions must be used within a TransactionProvider');
  }
  return context;
};

interface TransactionProviderProps {
  children: React.ReactElement;
}

export const TransactionProvider = ({ children }: TransactionProviderProps) => {
  const allTransactions = useSelector(memoizedGetTransactions({ id: 0 }));
  // Use a ref to hold the Map object to prevent unnecessary re-renders
  const activeConnectionsRef = useRef(new Map());
  const [activeConnections, setActiveConnections] = useState([]);

  const addConnection = (id: string, connection: any) => {
    activeConnectionsRef.current.set(id, {
      unsub: connection.unsub,
      timestamp: Date.now(),
    });
    setActiveConnections(
      Array.from(activeConnectionsRef.current.entries()).map(([id, connection]) => ({
        id,
        since: connection.timestamp,
      }))
    );
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
    return store.dispatch(
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
          mintQuotes: [...(tx.mintQuotes || []), ...(additionalData.mintQuotes || [])],
          proofStates: [...(tx.proofStates || []), ...(additionalData.proofStates || [])],
        }),
      })
    );
  };

  // Clean up connections when component unmounts
  useEffect(() => {
    // Take a snapshot when the effect runs
    const connectionsSnapshot = activeConnectionsRef.current;

    return () => {
      // Use the snapshot in the cleanup
      for (const [id, connection] of connectionsSnapshot.entries()) {
        if (connection?.unsub) {
          connection.unsub();
          removeConnection(id);
        }
      }
    };
  }, []);

  // Start listening to a transaction
  const listenToTransaction = async (transactions, forceRefresh = false) => {
    try {
      // if (transaction?.paid) {
      //   return;
      // }

      // join requests together with _ seperator
      const id =
        transactions?.[0]?.type === 'lightning'
          ? transactions.map((t: any) => t.request).join('_')
          : transactions.map((t: any) => t.token).join('_');

      // Skip if already listening
      if (activeConnectionsRef.current.has(id)) {
        return;
      }

      // group transactions by mintUrl and type, so we need:
      // { [mintUrl]: { lightning: [...], ecash: [...] } }
      const groupedTransactions = transactions
        .filter((tx: any) => tx.paid === false)
        .reduce((acc: any, tx: any) => {
          const mintUrl = tx.mintUrl;
          if (!acc[mintUrl]) {
            acc[mintUrl] = { lightning: [], ecash: [] };
          }
          if (tx.type === 'ecash') {
            acc[mintUrl].ecash.push(tx);
          } else {
            acc[mintUrl].lightning.push(tx);
          }
          return acc;
        }, {});

      // loop over mints
      for (const [mintUrl, txs] of Object.entries(groupedTransactions)) {
        // loop over txs
        const walletResult = await getWallet({
          mintUrl,
          unit: 'sat',
          forceRefresh,
          profile: null,
        });

        if (walletResult.isErr()) return err(walletResult.error);
        const wallet = walletResult.value;

        const activeKeyset = wallet.getActiveKeyset(
          wallet.keysets.filter((key) => key.unit === 'sat')
        );
        const keysetId = activeKeyset.id;
        wallet.keysetId = keysetId;

        for (const [type, txs_] of Object.entries(txs)) {
          try {
            injectWebSocketImpl(WebSocket);
            let unsub;

            if (type === 'ecash') {
              const proofs = _.flatMap(txs_.map((tx: any) => getDecodedToken(tx.token).proofs));
              unsub = await wallet.onProofStateUpdates(
                // flat map the proofs
                proofs,
                (
                  payload: ProofState & {
                    proof: Proof;
                  }
                ) => {
                  try {
                    const transaction = txs_.find((tx: any) =>
                      getDecodedToken(tx.token).proofs.find((p: any) => _.isEqual(p, payload.proof))
                    );

                    if (!transaction) return;

                    switch (payload.state) {
                      case 'PENDING':
                        updateTransactionStatus(transaction, 'pending', {
                          proofStates: [
                            {
                              ...payload,
                              addedAt: Date.now(),
                            },
                          ],
                        });
                        break;
                      case 'SPENT':
                        updateTransactionStatus(transaction, 'paid', {
                          paid: true,
                          completedAt: Date.now(),
                          proofStates: [
                            {
                              ...payload,
                              addedAt: Date.now(),
                            },
                          ],
                        });
                        unsub();
                        removeConnection(id);
                        break;
                      case 'UNSPENT':
                        updateTransactionStatus(transaction, 'unspent', {
                          proofStates: [
                            {
                              ...payload,
                              addedAt: Date.now(),
                            },
                          ],
                        });
                        break;
                      default:
                        break;
                    }
                  } catch (err) {
                    unsub();
                    removeConnection(id);
                    if (err.message === 'keyset id inactive.') {
                      listenToTransaction(transactions, true);
                    }
                  }
                },
                () => {
                  unsub();
                  removeConnection(id);
                }
              );
              if (unsub) {
                addConnection(id, unsub);
              }
            } else if (type === 'lightning') {
              unsub = await wallet.onMintQuoteUpdates(
                txs_.map((tx) => tx.mintQuote.quote),
                async (update: MintQuoteResponse) => {
                  try {
                    // This finds the current transaction thats being updated.
                    const transaction = txs_.find((tx) => tx.mintQuote.quote === update.quote);

                    if (!transaction) return;

                    switch (update.state) {
                      case 'UNPAID':
                        updateTransactionStatus(
                          {
                            request: transaction.request,
                            type: transaction.type,
                            transactionType: transaction.transactionType,
                            quote: transaction.mintQuote.quote,
                          },
                          'unpaid',
                          {
                            mintQuotes: [
                              {
                                ...update,
                                expiry: update.expiry ?? transaction.mintQuote.expiry,
                                addedAt: Date.now(),
                              },
                            ],
                          }
                        );
                        break;
                      case 'ISSUED':
                        updateTransactionStatus(
                          {
                            request: transaction.request,
                            type: transaction.type,
                            transactionType: transaction.transactionType,
                            quote: transaction.mintQuote.quote,
                          },
                          'issued',
                          {
                            mintQuotes: [
                              {
                                ...update,
                                expiry: update.expiry ?? transaction.mintQuote.expiry,
                                addedAt: Date.now(),
                              },
                            ],
                          }
                        );
                        const allQuotesPaid = allTransactions.filter((t) =>
                          transactions.some((t2) => t.request === t2.request)
                        );
                        if (allQuotesPaid) {
                          unsub();
                          removeConnection(id);
                        }
                        break;
                      case 'PAID':
                        const counter = memoizedGetCounterV2({
                          profileId: store.getState().nostr.currentProfile.id,
                          mintUrl,
                          keysetId: wallet.keysetId,
                        })(store.getState());

                        // Mint proofs
                        const proofsResult = await toResult(
                          wallet.mintProofs(transaction.amount, transaction.mintQuote.quote, {
                            counter,
                            keysetId: wallet.keysetId,
                          })
                        );
                        if (proofsResult.isErr()) return err(proofsResult.error);
                        const proofs = proofsResult.value;

                        // Increase counter
                        store.dispatch(
                          increaseCounterV2({
                            profileId: store.getState().nostr.currentProfile.id,
                            mintUrl,
                            keysetId: wallet.keysetId,
                            amount: proofs.length,
                          })
                        );

                        // Add proofs to redux
                        await store.dispatch(
                          appendProofsV2({
                            profileId: store.getState().nostr.currentProfile.id,
                            mintUrl,
                            proofs: proofs,
                          })
                        );

                        // Publish wallet event, this basically just makes sure we can restore our account via nostr
                        const currentProfileId = store.getState().nostr.currentProfile.id;
                        const existingTxs = memoizedGetTransactions({ id: currentProfileId })(
                          store.getState()
                        );
                        publishWalletEvent([
                          ...new Set([...existingTxs.map((t) => t.mintUrl), mintUrl]),
                        ]);

                        // Update transaction status to paid
                        showMessage('funds_sent', {
                          amount: transaction.amount,
                          unit: transaction.unit,
                        });

                        // We update the transaction status
                        updateTransactionStatus(
                          {
                            request: transaction.request,
                            type: transaction.type,
                            transactionType: transaction.transactionType,
                            quote: transaction.mintQuote.quote,
                          },
                          'paid',
                          {
                            paid: true,
                            completedAt: Date.now(),
                            mintQuotes: [
                              {
                                ...update,
                                expiry: update.expiry ?? transaction.mintQuote.expiry,
                                addedAt: Date.now(),
                              },
                            ],
                          }
                        );
                        break;
                    }
                  } catch (err) {
                    unsub();
                    removeConnection(id);
                    if (err.message === 'keyset id inactive.') {
                      listenToTransaction(transactions, true);
                    }
                  }
                },
                async (error) => {
                  showMessage(error.message);
                  unsub();
                  removeConnection(id);
                }
              );
              if (unsub) {
                addConnection(id, { unsub });
              }
            }
          } catch (error) {
            showMessage(error.message);
          }
        }
      }
    } catch (error) {
      console.log('error', { error });
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
    transactions: allTransactions,
    listenToTransaction,
    stopListening,
    getActiveConnections,
    activeConnections,
  };

  return <TransactionContext.Provider value={value}>{children}</TransactionContext.Provider>;
};
