import React, { useEffect, useState } from 'react';
import { Share } from 'react-native';
import { View, Text } from 'components/common/Themed';
import { Spinner } from 'components/common/Spinner';
import * as Clipboard from 'expo-clipboard';
import Modal from 'components/layout/Modal';
import { PaymentInfo } from 'components/layout/PaymentInfo';
import { useSelector } from 'react-redux';
import { showMessage, showSuccess } from 'helper/popup/popups';
import { ButtonHandler } from 'components/common/ButtonHandler';
import _ from 'lodash';
import {
  appendProofsV2,
  increaseCounterV2,
  memoizedGetCounterV2,
  memoizedGetTransactionByMatcher,
  memoizedGetTransactions,
  updateTransaction,
  useGetMintInfo,
} from 'helper/redux/cashu';
import { useNavigation } from 'expo-router';
import { useTransactions } from 'components/providers/TransactionsProvider';
import { getWallet } from 'helper/cashu';
import { store } from 'helper/redux/store';
import { Section } from 'components/common/Section';
import { withSheetProvider } from 'components/hocs/withSheetProvider';
import { TransactionHeader } from 'components/common/Transaction/TransactionHeader';
import { memoizedGetTheme } from 'helper/redux/settings';
import { truncateMiddle } from 'helper/strings';
import { Card } from 'components/common/Card';
import { useTypedRoute } from 'helper/navigation';

import type { ButtonHandlerButton } from 'components/common/ButtonHandler';
import { greens, greys } from 'helper/colors';
import { publishWalletEvent } from 'helper/nostr/cashu';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { MintQuoteResponse } from '@cashu/cashu-ts';
import { convertTime } from 'helper/time';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { TransactionMintRefresh } from 'components/common/Transaction/TransactionMintRefresh';

interface MintQuoteTimelineProps {
  mintQuotes?: (MintQuoteResponse & { date: Date })[];
  meltQuotes?: {
    state: 'UNSPENT' | 'PENDING' | 'SPENT';
    addedAt?: number;
    amount: number;
    [key: string]: any;
  }[];
  type: 'mint' | 'melt';
}

interface TimelineState {
  label: string;
  state: string;
  timestamp?: number;
  isActive?: boolean;
  isCompleted?: boolean;
}

export function MintQuoteTimeline({ meltQuotes = [], transaction }: MintQuoteTimelineProps) {
  const theme = useSelector(memoizedGetTheme);
  const [collapsed, setCollapsed] = useState(false);

  const getTimeline = (meltQuotes) => {
    const quotes = Object.fromEntries(meltQuotes.map((q) => [q.state, q]));
    const states = ['UNSPENT', 'PENDING', 'SPENT'];

    // If transaction is cancelled, add CANCELLED as the final state
    if (transaction?.isCancel) {
      states.push('CANCELLED');
    }

    let maxIndex = Math.max(...meltQuotes.map((q) => states.indexOf(q.state)));

    // If cancelled, the CANCELLED state becomes the current (final) state
    if (transaction?.isCancel) {
      maxIndex = states.length - 1; // CANCELLED is the last state
    }

    return states.map((state, i) => {
      // For CANCELLED state, create a synthetic entry if it doesn't exist in quotes
      if (state === 'CANCELLED' && !quotes[state]) {
        return {
          state,
          complete: true, // CANCELLED state is always complete when present
          isCurrent: transaction?.isCancel, // CANCELLED is current when transaction is cancelled
        };
      }

      return {
        state,
        ...quotes[state],
        complete: i <= maxIndex,
        isCurrent: i === maxIndex,
      };
    });
  };

  const states = getTimeline(meltQuotes);

  // Check if we have intermediary steps (both UNSPENT and PENDING)
  const hasIntermediarySteps =
    meltQuotes.some((q) => q.state === 'UNSPENT') && meltQuotes.some((q) => q.state === 'PENDING');

  // If there are intermediary steps, always show expanded view
  const shouldCollapse = collapsed && !hasIntermediarySteps;

  const displayStates = shouldCollapse
    ? states.filter((_, i) => i === 0 || i === states.length - 1)
    : states;

  const barWidth = 4.5;
  const barHeight = 48;
  const barMarginVertical = 4;
  const dotSize = barWidth;
  const dotSpacing = 8;

  // Helper function to get bar color based on state
  const getBarColor = (item) => {
    if (item.state === 'CANCELLED') {
      return '#ef4444'; // Red color for cancelled state
    }
    return item.complete ? greens[300] : greys(theme)[400];
  };

  if (!meltQuotes.length) {
    return null;
  }

  return (
    <View
      style={{
        backgroundColor: greys(theme)[1800],
        padding: 16,
        margin: 16,
        borderRadius: 12,
      }}>
      <Text
        size={14}
        bold
        style={{
          color: greys(theme)[400],
          marginBottom: 8,
          textTransform: 'uppercase',
        }}>
        {transaction?.isCancel ? 'CANCELLED' : _.last(meltQuotes)?.state}
      </Text>

      <View>
        {displayStates.map((item, index) => (
          <React.Fragment key={`${item.state}-${index}`}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginVertical: 0,
              }}>
              <View
                style={{
                  width: barWidth,
                  height: barHeight,
                  backgroundColor: getBarColor(item),
                  borderRadius: barWidth / 2,
                  marginVertical: barMarginVertical,
                  opacity: item.isCurrent ? 1 : 0.5,
                }}
              />
              <View
                style={{
                  flex: 1,
                }}>
                <Text
                  size={16}
                  bold
                  style={{
                    color: greys(theme)[0],
                    marginStart: 12,
                  }}>
                  {item.state}
                </Text>
                {item.addedAt && (
                  <Text
                    size={12}
                    bold
                    style={{
                      color: greys(theme)[600],
                      marginStart: 12,
                    }}>
                    {convertTime(new Date(item.addedAt))}
                  </Text>
                )}
              </View>
            </View>

            {shouldCollapse && index === 0 && states.length > 2 && (
              <View
                style={{
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  opacity: 0.5,
                }}>
                {[...Array(3)].map((_, i) => (
                  <View
                    key={i}
                    style={{
                      width: dotSize,
                      height: dotSize,
                      backgroundColor: states[1].complete ? greens[300] : greys(theme)[400],
                      borderRadius: dotSize / 3,
                      marginVertical: dotSpacing / 3,
                    }}
                  />
                ))}
              </View>
            )}
          </React.Fragment>
        ))}
      </View>

      {/* Only show collapse button if there are no intermediary steps */}
      {!hasIntermediarySteps && (
        <TouchableOpacity onPress={() => setCollapsed(!collapsed)}>
          <Text
            size={14}
            bold
            style={{
              color: greys(theme)[400],
              marginBottom: 8,
              textTransform: 'uppercase',
              textAlign: 'right',
            }}>
            {collapsed ? 'EXPAND' : 'COLLAPSE'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export function LightningReceiveConfirmation({
  request,
  paymentRequest = '',
  unit,
  amount,
  autoGoBackOnPaid = true,
  extraButtons = [],
}: {
  request: string;
  paymentRequest?: string;
  unit: string;
  amount: number;
  autoGoBackOnPaid?: boolean;
  extraButtons?: ButtonHandlerButton[];
}) {
  const navigation = useNavigation();
  const theme = useSelector(memoizedGetTheme);
  const [uri, setUri] = useState(null);
  const currentProfile = useSelector(memoizedGetCurrentProfile);

  const getCurrentTransaction = useSelector(
    memoizedGetTransactionByMatcher({
      profileId: currentProfile.id,
      matcher: (txs) => {
        return _.filter(txs, {
          request: request,
          type: 'lightning',
          unit: unit,
          amount: amount,
        });
      },
    })
  );

  // Auto-navigate back when payment is received
  useEffect(() => {
    if (autoGoBackOnPaid && getCurrentTransaction?.[0]?.paid) {
      const timer = setTimeout(() => {
        navigation.goBack();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [autoGoBackOnPaid, getCurrentTransaction[0]?.paid, navigation]);

  const handleCopy = async (onClose) => {
    await Clipboard.setStringAsync(request);
    showSuccess('lightning_address_copied', {}, {}, onClose);
  };

  const handleShare = async (onClose) => {
    if (uri) {
      await Share.share({
        url: uri,
        message: request,
      });
    }
    onClose();
  };

  // Format currency display options
  const getCurrencyOptions = (denominationType) => ({
    locale: 'en-US',
    precision: denominationType === 'btc' ? 8 : 2,
    currencyDisplay: 'symbol',
    denomination: denominationType,
  });

  // Currency data object
  const getCurrencyData = () => ({
    currency: unit === 'sat' ? 'BTC' : unit.toUpperCase(),
    value: amount,
    denomination: unit === 'sat' ? 'sats' : unit,
  });

  const isBitcoin = unit === 'sat';

  const { listenToTransaction, activeConnections } = useTransactions();

  useEffect(() => {
    if (!getCurrentTransaction?.[0].paid) {
      listenToTransaction([getCurrentTransaction?.[0]]);
    }
  }, [getCurrentTransaction?.[0].paid]);

  const isListening = activeConnections?.some((connection) =>
    connection.id.includes(getCurrentTransaction[0].request)
  );

  const handleCheckStatus = async (onClose, forceRefresh = false) => {
    try {
      const currentTx = getCurrentTransaction[0];
      const wallet = await getWallet({
        unit: currentTx.unit,
        mintUrl: currentTx.mintUrl,
        profile: null,
      });
      const activeKeyset = wallet.getActiveKeyset(
        wallet.keysets.filter((key) => key.unit === 'sat')
      );
      const keysetId = activeKeyset.id;
      wallet.keysetId = keysetId;

      const status = await wallet.checkMintQuote(currentTx.mintQuote?.quote);

      if (status.state === 'PAID') {
        const profileId = store.getState().nostr?.currentProfile?.id;

        const counter = memoizedGetCounterV2({
          profileId: store.getState().nostr.currentProfile.id,
          mintUrl: currentTx.mintUrl,
          keysetId: wallet.keysetId,
        })(store.getState());

        // Mint proofs
        const proofs = await wallet.mintProofs(amount, currentTx.mintQuote.quote, {
          counter,
          keysetId: wallet.keysetId,
        });

        // Increase counter
        store.dispatch(
          increaseCounterV2({
            profileId: store.getState().nostr.currentProfile.id,
            mintUrl: currentTx.mintUrl,
            keysetId: wallet.keysetId,
            amount: proofs.length,
          })
        );

        // Add proofs to redux
        await store.dispatch(
          appendProofsV2({
            profileId: store.getState().nostr.currentProfile.id,
            mintUrl: currentTx.mintUrl,
            proofs: proofs,
          })
        );

        // Publish wallet event, this basically just makes sure we can restore our account via nostr
        const currentProfileId = store.getState().nostr.currentProfile.id;
        const existingTxs = memoizedGetTransactions({ id: currentProfileId })(store.getState());
        publishWalletEvent([...new Set([...existingTxs.map((t) => t.mintUrl), currentTx.mintUrl])]);

        // Update transaction status to paid
        showMessage('funds_sent', {
          amount: currentTx.amount,
          unit: currentTx.unit,
        });

        await store.dispatch(
          updateTransaction({
            profileId,
            matcher: (tx) => tx.request === currentTx.request,
            updateFn: (tx) => ({
              ...tx,
              paid: true,
            }),
          })
        );

        showMessage(
          'funds_received',
          { amount: currentTx.amount, unit: currentTx.unit },
          { emoji: '🎉' },
          onClose
        );
      } else if (status.state === 'ISSUED') {
      } else {
        showMessage('lightning_transaction_pending', {}, { emoji: '❌' }, onClose);
      }
    } catch (error) {
      if (error.message === 'keyset id inactive.') {
        handleCheckStatus(onClose, true);
      } else {
      }
    }
  };

  const mintInfo = useGetMintInfo({ mintUrl: getCurrentTransaction[0].mintUrl });

  return (
    <Modal
      showClose
      title={`Receive ${isBitcoin ? 'Bitcoin' : unit.toUpperCase()}`}
      children={
        <>
          <TransactionHeader
            transaction={{
              ...getCurrentTransaction[0],
              unit,
              amount,
              transactionType: 'receive',
            }}
          />
          {!getCurrentTransaction[0].paid && !getCurrentTransaction[0].fromNIP05 && (
            <PaymentInfo
              showSection={false}
              setUri={setUri}
              data={[
                { name: 'Lightning', value: request },
                // { name: 'Ecash', value: paymentRequest },
              ]}
              unit={unit}
              popupMessage={[
                {
                  name: 'lightning_address_copied',
                  value: request,
                },
                // {
                //   name: 'payment_request_copied',
                //   value: paymentRequest,
                // },
              ]}
            />
          )}
          {getCurrentTransaction[0].memo && (
            <View
              style={{
                margin: 16,
                marginTop: 12,
                marginBottom: 0,
              }}>
              <Card message={getCurrentTransaction[0].memo} variant="info" />
            </View>
          )}
          <TransactionMintRefresh
            mintInfo={mintInfo}
            transaction={{ ...getCurrentTransaction[0], transactionType: 'receive' }}
            handleCheckStatus={handleCheckStatus}
          />

          <Section
            special={false}
            items={[
              {
                title: 'Request',
                value: getCurrentTransaction[0].fromNIP05
                  ? truncateMiddle(getCurrentTransaction[0].fromNIP05.split('@')[0], 4) +
                    '@' +
                    getCurrentTransaction[0].fromNIP05.split('@')[1]
                  : truncateMiddle(request, 10),
              },
              {
                title: 'Type',
                value: 'Lightning • Receive',
              },
              {
                title: 'Status',
                value: (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text
                      style={{
                        color: greys(theme)[0],
                        fontSize: 16,
                        fontFamily: 'OverpassBold',
                      }}>
                      {getCurrentTransaction[0].paid ? 'Completed' : 'Pending'}
                    </Text>
                    {isListening && <Spinner style={{ marginLeft: 4 }} size={12} />}
                  </View>
                ),
              },
              // {
              //   title: 'Listening',
              //   value: String(isListening),
              // },
            ]}
          />
        </>
      }
      buttons={
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'transparent',
            paddingBottom: 8,
          }}>
          <ButtonHandler
            buttons={
              getCurrentTransaction[0].paid
                ? []
                : [
                    {
                      text: 'Copy',
                      icon: 'lets-icons:copy',
                      variant: 'primary',
                      onPress: handleCopy,
                    },
                    {
                      text: 'Share',
                      icon: 'ri:share-fill',
                      variant: 'secondary',
                      onPress: handleShare,
                    },
                    {
                      text: 'Check Status',
                      icon: 'humbleicons:refresh',
                      variant: 'secondary',
                      onPress: handleCheckStatus,
                    },
                    ...extraButtons,
                  ]
            }
          />
        </View>
      }
    />
  );
}

function ModalScreen() {
  const {
    request,
    paymentRequest = '',
    unit,
    amount,
  } = useTypedRoute<'lightningReceiveConfirmation'>();

  return (
    <LightningReceiveConfirmation
      request={request}
      paymentRequest={paymentRequest}
      unit={unit}
      amount={amount}
    />
  );
}

export default withSheetProvider(ModalScreen);
