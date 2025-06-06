import { useEffect, useState, createContext, useContext, useRef } from 'react';
import { useSelector } from 'react-redux';
import { store } from 'helper/redux/store';
import {
  CashuMint,
  CashuWallet,
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
import { getMint, getWallet } from 'components/cashu';
import _ from 'lodash';

const TransactionContext = createContext(null);

export const useTransactions = () => {
  const context = useContext(TransactionContext);
  if (!context) {
    throw new Error('useTransactions must be used within a TransactionProvider');
  }
  return context;
};

export const TransactionProvider = ({ children }) => {
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
  const listenToTransaction = async (transactions, forceRefresh = false) => {
    try {
      console.log('listenToTransaction', transactions);

      // if (transaction?.paid) {
      //   return;
      // }

      // join requests together with _ seperator
      const id =
        transactions?.type === 'lightning'
          ? transactions.map((t: any) => t.request).join('_')
          : transactions.map((t: any) => t.token).join('_');
      console.log('listenToTransaction id', id);

      // Skip if already listening
      if (activeConnectionsRef.current.has(id)) {
        return;
      }

      console.log('listenToTransaction transactions', transactions);

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

      console.log('listenToTransaction groupedTransactions', groupedTransactions);

      // loop over mints
      for (const [mintUrl, txs] of Object.entries(groupedTransactions)) {
        console.log('listenToTransaction mintUrl', mintUrl);
        console.log('listenToTransaction txs', txs);
        // loop over txs
        const w = await getWallet({
          mintUrl,
          unit: 'sat',
          forceRefresh,
        });
        const activeKeyset = w.getActiveKeyset(w.keysets.filter((key) => key.unit === 'sat'));
        const keysetId = activeKeyset.id;
        w.keysetId = keysetId;

        console.log('listenToTransaction w', w);

        for (const [type, txs_] of Object.entries(txs)) {
          console.log('listenToTransaction txs_', type, txs_);
          try {
            injectWebSocketImpl(WebSocket);
            let unsub;

            console.log(
              'test',
              txs_.map((tx: any) => tx.proof)
            );

            if (type === 'ecash') {
              const proofs = _.flatMap(txs_.map((tx: any) => getDecodedToken(tx.token).proofs));
              console.log('proofs', { proofs });
              unsub = await w.onProofStateUpdates(
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
                        break;
                      case 'SPENT':
                        updateTransactionStatus(transaction, 'paid', {
                          paid: true,
                          completedAt: Date.now(),
                        });
                        unsub();
                        removeConnection(id);
                        break;
                      case 'UNSPENT':
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
                (err) => {
                  unsub();
                  removeConnection(id);
                }
              );
            } else if (type === 'lightning') {
              console.log(
                'listenToTransaction txs_.map((tx) => tx.mintQuote.quote)',
                txs_.map((tx) => tx.mintQuote.quote)
              );
              unsub = await w.onMintQuoteUpdates(
                txs_.map((tx) => tx.mintQuote.quote),
                async (update: MintQuoteResponse) => {
                  try {
                    // This finds the current transaction thats being updated.
                    const transaction = txs_.find((tx) => tx.mintQuote.quote === update.quote);
                    console.log('listenToTransaction transaction', transaction);

                    if (!transaction) return;

                    const isPaid = update.state === 'PAID';

                    // We only really care about paid events
                    if (isPaid) {
                      const counter = memoizedGetCounterV2({
                        profileId: store.getState().nostr.currentProfile.id,
                        mintUrl,
                        keysetId: w.keysetId,
                      })(store.getState());

                      // Mint proofs
                      const proofs = await w.mintProofs(
                        transaction.amount,
                        transaction.mintQuote.quote,
                        {
                          counter,
                          keysetId: w.keysetId,
                        }
                      );

                      // Increase counter
                      store.dispatch(
                        increaseCounterV2({
                          profileId: store.getState().nostr.currentProfile.id,
                          mintUrl,
                          keysetId: w.keysetId,
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
                        { paid: true, completedAt: Date.now() }
                      );

                      // Important: We clean up the connection only if ALL quotes are paid
                      // get txs from allTransactions and find ones where the request matches the current transaction
                      const allQuotesPaid = allTransactions.filter((t) =>
                        transactions.some((t2) => t.request === t2.request)
                      );
                      console.log('listenToTransaction allQuotesPaid', allQuotesPaid);
                      if (allQuotesPaid) {
                        unsub();
                        removeConnection(id);
                      }
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
