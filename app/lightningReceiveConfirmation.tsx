import React, { useEffect, useState } from 'react';
import { Share } from 'react-native';
import { Spacer, View } from 'components/common/View';
import { Text } from 'components/common/Text';
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
  TransactionBuilder,
  updateTransaction,
  useGetMintInfo,
} from 'helper/redux/cashu';
import { useNavigation } from 'expo-router';
import { getWallet, getRawExpiry } from 'helper/cashuClient';
import { toResult } from 'helper/toResult';
import { store } from 'helper/redux/store';
import { Section } from 'components/common/Section';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { TransactionHeader } from 'components/common/Transaction/TransactionHeader';
import { memoizedGetTheme } from 'helper/redux/settings';
import { truncateMiddle } from 'helper/strings';
import { Card } from 'components/common/Card';
import { useTypedNavigation, useTypedRoute } from 'helper/navigation';

import type { ButtonHandlerButton } from 'components/common/ButtonHandler';
import { greens, greys } from 'helper/colors';
import { publishWalletEvent } from 'helper/nostr/cashu';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { MintQuoteResponse } from '@cashu/cashu-ts';
import { convertTime } from 'helper/time';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { TransactionMintRefresh } from 'components/common/Transaction/TransactionMintRefresh';
import Icon from 'assets/icons';
import { TransactionDebugCode } from 'components/common/Transaction/TransactionDebugCode';
import opacity from 'hex-color-opacity';
import { err } from 'neverthrow';
import { useAutoListenBatch } from 'components/providers/TransactionsProvider';
import { Spinner } from 'components/common/Spinner';
import { Essential } from 'helper/Essential';
interface MintQuoteTimelineProps {
  mintQuotes?: (MintQuoteResponse & { addedAt?: number })[];
  meltQuotes?: {
    state: 'UNSPENT' | 'PENDING' | 'SPENT';
    addedAt?: number;
    amount: number;
    [key: string]: any;
  }[];
  type: 'mint' | 'melt';
  transaction?: Essential<
    TransactionBuilder,
    | 'mintQuote'
    | 'request'
    | 'token'
    | 'date'
    | 'isCancel'
    | 'amount'
    | 'unit'
    | 'paid'
    | 'type'
    | 'state'
  >;
}

export function MintQuoteTimeline({
  mintQuotes = [],
  meltQuotes = [],
  type = 'melt',
  transaction,
}: MintQuoteTimelineProps) {
  const theme = useSelector(memoizedGetTheme);
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigation = useTypedNavigation();

  const expiryDate = transaction?.request ? getRawExpiry({ pr: transaction.request }) : null;
  const isExpired = expiryDate && new Date() > expiryDate;
  const getTimeline = () => {
    if (type === 'mint') {
      const quotes = Object.fromEntries(mintQuotes.map((q) => [q.state, q]));
      const states = ['CREATED', 'UNPAID', ...(isExpired ? ['EXPIRED'] : ['ISSUED', 'PAID'])];

      let maxIndex = Math.max(-1, ...mintQuotes.map((q) => states.indexOf(q.state)));
      if (isExpired) {
        maxIndex = states.length - 1;
      }

      return states.map((state, i) => ({
        state,
        ...quotes[state],
        complete: i <= maxIndex,
        isCurrent: i === maxIndex,
      }));
    }

    const quotes = Object.fromEntries(meltQuotes.map((q) => [q.state, q]));
    const states = ['CREATED', 'UNSPENT', 'PENDING', 'SPENT'];

    if (transaction?.isCancel) {
      states.push('CANCELLED');
    }

    let maxIndex = Math.max(...meltQuotes.map((q) => states.indexOf(q.state)));
    if (transaction?.isCancel) {
      maxIndex = states.length - 1;
    }

    return states.map((state, i) => {
      if (state === 'CANCELLED' && !quotes[state]) {
        return {
          state,
          complete: true,
          isCurrent: transaction?.isCancel,
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

  const states = getTimeline();

  const hasIntermediarySteps =
    type === 'mint'
      ? mintQuotes.some((q) => q.state === 'UNPAID') && mintQuotes.some((q) => q.state === 'PAID')
      : meltQuotes.some((q) => q.state === 'UNSPENT') &&
        meltQuotes.some((q) => q.state === 'PENDING');

  const shouldCollapse = collapsed && !hasIntermediarySteps;

  const displayStates = shouldCollapse
    ? states.filter((_, i) => i === 0 || i === states.length - 1)
    : states;

  const barWidth = 4.5;
  const barHeight = 48;
  const barMarginVertical = 4;
  const dotSize = barWidth;
  const dotSpacing = 8;

  const getBarColor = (item: any) => {
    if (item.state === 'CANCELLED' || item.state === 'EXPIRED') {
      return '#ef4444';
    }

    return item.complete ? greens[300] : greys(theme)[200];
  };

  if (type === 'mint' ? !mintQuotes.length : !meltQuotes.length) {
    return null;
  }

  const getStateLabel = (s: string) => {
    switch (s) {
      case 'UNPAID':
        return 'PENDING';
      default:
        return s;
    }
  };

  return (
    <View
      blur
      style={{
        backgroundColor: greys(theme)[800],
        padding: 16,
        marginHorizontal: 16,
        borderRadius: 12,
      }}>
      <Text
        size={14}
        bold
        style={{
          color: greys(theme)[200],
          marginBottom: 8,
          textTransform: 'uppercase',
        }}>
        {getStateLabel(
          isExpired
            ? 'EXPIRED'
            : type === 'mint'
              ? _.last(mintQuotes)?.state
              : transaction?.isCancel
                ? 'CANCELLED'
                : _.last(meltQuotes)?.state
        )}
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
              <TouchableOpacity
                onPress={() => {
                  if (transaction?.isCancel && item.state === 'CANCELLED') {
                    navigation.navigate(
                      'transaction',
                      {
                        id: transaction?.request || transaction?.token,
                        transactionType: 'receive',
                      },
                      {
                        closeCurrentAndParents: true,
                      }
                    );
                  }
                }}
                style={{
                  flex: 1,
                  ...(transaction?.isCancel && item.state === 'CANCELLED'
                    ? {
                        backgroundColor: opacity(greys(theme)[900], 0.75),
                        borderColor: greys(theme)[600],
                        borderWidth: 0.33,
                        borderRadius: 8,
                      }
                    : {}),
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginVertical: barMarginVertical,
                  overflow: 'hidden',
                }}>
                <View
                  style={{
                    width: barWidth,
                    height: barHeight,
                    backgroundColor: getBarColor(item),
                    borderRadius: barWidth / 2,
                    // marginVertical: barMarginVertical,
                    opacity: item.isCurrent ? 1 : 0.5,
                  }}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    size={16}
                    bold
                    style={{
                      color: greys(theme)[0],
                      marginStart: 12,
                    }}>
                    {getStateLabel(item.state)}
                  </Text>
                  {item.addedAt ? (
                    <Text
                      size={12}
                      bold
                      style={{
                        color: greys(theme)[300],
                        marginStart: 12,
                      }}>
                      {convertTime(new Date(item.addedAt))}
                    </Text>
                  ) : transaction?.date && item.state === 'CREATED' ? (
                    <Text
                      size={12}
                      bold
                      style={{
                        color: greys(theme)[300],
                        marginStart: 12,
                      }}>
                      {convertTime(new Date(transaction.date))}
                    </Text>
                  ) : transaction?.isCancel ? (
                    <Text
                      size={12}
                      bold
                      style={{
                        color: greys(theme)[300],
                        marginStart: 12,
                      }}>
                      Open Transaction
                    </Text>
                  ) : null}
                </View>
                {transaction?.isCancel && item.state === 'CANCELLED' && (
                  <Icon
                    style={{
                      marginRight: 8,
                    }}
                    spin={
                      loading
                        ? {
                            delay: 0,
                            duration: 1500,
                            outputRange: ['0deg', '360deg'],
                            easing: 'easeOut',
                          }
                        : undefined
                    }
                    size={20}
                    name="lucide:arrow-right"
                  />
                )}
              </TouchableOpacity>
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
                      backgroundColor: states[1].complete ? greens[300] : greys(theme)[200],
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

      {/* Collapse toggle */}
      {!hasIntermediarySteps && (
        <TouchableOpacity onPress={() => setCollapsed(!collapsed)}>
          <Text
            size={14}
            bold
            style={{
              color: greys(theme)[200],
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

  const isBitcoin = unit === 'sat';

  const { isListening } = useAutoListenBatch(getCurrentTransaction);

  const handleCheckStatus = async (onClose, forceRefresh) => {
    const currentTx = getCurrentTransaction[0];
    const walletRes = await getWallet({
      unit: currentTx.unit,
      mintUrl: currentTx.mintUrl,
      profile: null,
      forceRefresh,
    });
    if (walletRes.isErr()) {
      if (walletRes.error.message === 'keyset id inactive.') {
        handleCheckStatus(onClose, true);
      }
      return;
    }
    const wallet = walletRes.value;
    const activeKeyset = wallet.getActiveKeyset(
      wallet.keysets.filter((key) => key.unit === currentTx.unit)
    );
    const keysetId = activeKeyset.id;
    wallet.keysetId = keysetId;

    const statusRes = await toResult(wallet.checkMintQuote(currentTx.mintQuote?.quote));
    if (statusRes.isErr()) {
      showMessage(statusRes.error.message);
      return;
    }
    const status = statusRes.value;

    if (status.state === 'PAID') {
      const profileId = store.getState().nostr?.currentProfile?.id;

      const counter = memoizedGetCounterV2({
        profileId: store.getState().nostr.currentProfile.id,
        mintUrl: currentTx.mintUrl,
        keysetId: wallet.keysetId,
      })(store.getState());

      // Mint proofs
      const proofsResult = await toResult(
        wallet.mintProofs(amount, currentTx.mintQuote.quote, {
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
  };

  const mintInfo = useGetMintInfo({ mintUrl: getCurrentTransaction[0].mintUrl });

  return (
    <Modal
      showClose
      title={`Receive ${isBitcoin ? 'Bitcoin' : unit.toUpperCase()}`}
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
            buttons={[
              {
                text: 'Copy',
                icon: 'lets-icons:copy',
                variant: 'primary',
                onPress: handleCopy,
                condition: !getCurrentTransaction[0].paid,
              },
              {
                text: 'Share',
                icon: 'ri:share-fill',
                variant: 'secondary',
                onPress: handleShare,
                condition: !getCurrentTransaction[0].paid,
              },
              {
                text: 'Check Status',
                icon: 'humbleicons:refresh',
                variant: 'secondary',
                onPress: handleCheckStatus,
                condition: !getCurrentTransaction[0].paid,
              },
              ...extraButtons.map((button) => ({
                ...button,
                condition: !getCurrentTransaction[0].paid,
              })),
            ]}
          />
        </View>
      }>
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
      <Spacer size={12} />
      {getCurrentTransaction[0].memo && (
        <>
          <View
            style={{
              marginHorizontal: 16,
            }}>
            <Card message={getCurrentTransaction[0].memo} variant="info" />
          </View>
          <Spacer size={12} />
        </>
      )}

      <TransactionMintRefresh
        mintInfo={mintInfo}
        transaction={{ ...getCurrentTransaction[0], transactionType: 'receive' }}
        handleCheckStatus={handleCheckStatus}
      />
      <Spacer size={12} />

      <MintQuoteTimeline
        transaction={getCurrentTransaction[0]}
        type="mint"
        mintQuotes={getCurrentTransaction[0].mintQuotes}
      />
      <Spacer size={12} />

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
        ]}
      />
      <Spacer size={12} />

      <TransactionDebugCode transaction={getCurrentTransaction[0]} />
    </Modal>
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
