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
import { toResult } from 'helper/toResult';

interface ActiveConnection {
  id: string;
  since: number;
}

interface TransactionContextType {
  transactions: any[];
  listenToTransaction: (transactions: any[], forceRefresh?: boolean) => Promise<void>;
  stopListening: (id: string) => void;
  getActiveConnections: () => ActiveConnection[];
  activeConnections: ActiveConnection[];
}

const TransactionContext = createContext<TransactionContextType | null>(null);

export const useAutoListenBatch = (transactions: any[] = [], options = { enabled: true }) => {
  const hasStarted = useRef(false);

  const context = useTransactions();

  // Always call hooks at the top level
  const isListening = useMemo(() => {
    if (!context) return false;

    return (
      transactions.length > 0 &&
      transactions.every((tx: any) =>
        context.activeConnections.some((conn) => conn.id.includes(tx.request || tx.token))
      )
    );
  }, [transactions, context?.activeConnections]);

  if (!context) return { isListening: false };

  const { listenToTransaction, activeConnections } = context;

  // Precompute preconditions
  const allUnpaid = transactions.every((tx: any) => tx.paid !== true);
  const allInactive = transactions.every((tx: any) => {
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
  const activeConnectionsRef = useRef(new Map<string, { unsub: any; timestamp: number }>());
  const [activeConnections, setActiveConnections] = useState<ActiveConnection[]>([]);

  const addConnection = (id: string, connection: any) => {
    activeConnectionsRef.current.set(id, {
      unsub: connection.unsub || connection,
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
    setActiveConnections(
      Array.from(activeConnectionsRef.current.entries()).map(([id, connection]) => ({
        id,
        since: connection.timestamp,
      }))
    );
  };

  // Helper function to update transaction status in Redux
  const updateTransactionStatus = (
    transaction: {
      token?: string;
      type: string;
      transactionType: string;
      request?: string;
      mintQuote?: { quote: string };
    },
    status: string,
    additionalData: {
      paid?: boolean;
      completedAt?: number;
      mintQuotes?: any[];
      proofStates?: any[];
      [key: string]: any;
    } = {}
  ) => {
    return store.dispatch(
      updateTransaction({
        profileId: 0,
        matcher: (tx) => {
          return transaction.type === 'ecash'
            ? tx.token === transaction.token &&
                tx.type === transaction.type &&
                tx.transactionType === transaction.transactionType
            : tx.request === transaction.request &&
                tx.type === transaction.type &&
                tx.transactionType === transaction.transactionType &&
                (tx as any).mintQuote?.quote === transaction.mintQuote?.quote;
        },
        updateFn: (tx) => ({
          ...tx,
          ...additionalData,
          // Add these fields to the transaction if they exist
          ...(additionalData.mintQuotes && {
            mintQuotes: [...((tx as any).mintQuotes || []), ...additionalData.mintQuotes],
          }),
          ...(additionalData.proofStates && {
            proofStates: [...((tx as any).proofStates || []), ...additionalData.proofStates],
          }),
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
  const listenToTransaction = async (transactions: any[], forceRefresh = false): Promise<void> => {
    try {
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
        const txsTyped = txs as { lightning: any[]; ecash: any[] };

        // loop over txs
        const walletResult = await getWallet({
          mintUrl,
          unit: 'sat', // todo, use correct unit.
          forceRefresh,
          profile: null,
        });

        if (walletResult.isErr()) {
          if (walletResult.error.message === 'keyset id inactive.') {
            await listenToTransaction(transactions, true);
          }
          return;
        }
        const wallet = walletResult.value;

        const activeKeyset = wallet.getActiveKeyset(
          wallet.keysets.filter((key) => key.unit === 'sat') // todo: use correct unit.
        );
        const keysetId = activeKeyset.id;
        wallet.keysetId = keysetId;

        for (const [type, txs_] of Object.entries(txsTyped)) {
          try {
            injectWebSocketImpl(WebSocket);
            let unsub: any;

            if (type === 'ecash') {
              const proofs = _.flatMap(
                (txs_ as any[]).map((tx: any) => getDecodedToken(tx.token).proofs)
              );
              unsub = await wallet.onProofStateUpdates(
                // flat map the proofs
                proofs,
                (
                  payload: ProofState & {
                    proof: Proof;
                  }
                ) => {
                  try {
                    const transaction = (txs_ as any[]).find((tx: any) =>
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
                        // Show success message for sent funds
                        showMessage(
                          'funds_sent',
                          {
                            amount: transaction.amount,
                            unit: transaction.unit,
                          },
                          { emoji: '🎉' }
                        );

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
                        if (unsub) unsub();
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
                  } catch (error: any) {
                    if (unsub) unsub();
                    removeConnection(id);
                    if (error.message === 'keyset id inactive.') {
                      listenToTransaction(transactions, true);
                    }
                  }
                },
                () => {
                  if (unsub) unsub();
                  removeConnection(id);
                }
              );
              if (unsub) {
                addConnection(id, unsub);
              }
            } else if (type === 'lightning') {
              unsub = await wallet.onMintQuoteUpdates(
                (txs_ as any[]).map((tx: any) => tx.mintQuote.quote),
                async (update: MintQuoteResponse) => {
                  try {
                    // This finds the current transaction thats being updated.
                    const transaction = (txs_ as any[]).find(
                      (tx: any) => tx.mintQuote.quote === update.quote
                    );

                    if (!transaction) return;

                    switch (update.state) {
                      case 'UNPAID':
                        updateTransactionStatus(transaction, 'unpaid', {
                          mintQuotes: [
                            {
                              ...update,
                              expiry: update.expiry ?? transaction.mintQuote.expiry,
                              addedAt: Date.now(),
                            },
                          ],
                        });
                        break;
                      case 'PAID':
                        // This is the key fix: mint proofs immediately when PAID, just like handleCheckStatus
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

                        if (proofsResult.isErr()) {
                          console.error('Error minting proofs:', proofsResult.error);
                          return;
                        }
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
                        showMessage('funds_received', {
                          amount: transaction.amount,
                          unit: transaction.unit,
                        });

                        // We update the transaction status
                        updateTransactionStatus(transaction, 'paid', {
                          paid: true,
                          completedAt: Date.now(),
                          mintQuotes: [
                            {
                              ...update,
                              expiry: update.expiry ?? transaction.mintQuote.expiry,
                              addedAt: Date.now(),
                            },
                          ],
                        });

                        // Unsubscribe after successful payment
                        if (unsub) unsub();
                        removeConnection(id);
                        break;
                      case 'ISSUED':
                        // ISSUED means proofs were already minted, just update the status
                        updateTransactionStatus(transaction, 'issued', {
                          mintQuotes: [
                            {
                              ...update,
                              expiry: update.expiry ?? transaction.mintQuote.expiry,
                              addedAt: Date.now(),
                            },
                          ],
                        });
                        // Don't unsubscribe here in case we missed the PAID event
                        break;
                    }
                  } catch (error: any) {
                    if (unsub) unsub();
                    removeConnection(id);
                    if (error.message === 'keyset id inactive.') {
                      listenToTransaction(transactions, true);
                    }
                  }
                },
                async (error: any) => {
                  showMessage(error.message);
                  if (unsub) unsub();
                  removeConnection(id);
                }
              );
              if (unsub) {
                addConnection(id, { unsub });
              }
            }
          } catch (error: any) {
            showMessage(error.message);
          }
        }
      }
    } catch (error: any) {
      console.log('error', { error });
    }
  };

  // Stop listening to a transaction
  const stopListening = (id: string) => {
    const connection = activeConnectionsRef.current.get(id);
    if (connection && connection.unsub) {
      connection.unsub();
      // Remove transaction from active connections
      activeConnectionsRef.current.delete(id);
      setActiveConnections(
        Array.from(activeConnectionsRef.current.entries()).map(([id, connection]) => ({
          id,
          since: connection.timestamp,
        }))
      );
    }
  };

  const getActiveConnections = (): ActiveConnection[] =>
    Array.from(activeConnectionsRef.current.entries()).map(([id, connection]) => ({
      id,
      since: connection.timestamp,
    }));

  const value: TransactionContextType = {
    transactions: allTransactions,
    listenToTransaction,
    stopListening,
    getActiveConnections,
    activeConnections,
  };

  return <TransactionContext.Provider value={value}>{children}</TransactionContext.Provider>;
};
