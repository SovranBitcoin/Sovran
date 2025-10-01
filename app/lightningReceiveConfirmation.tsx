import React, { useEffect, useState } from 'react';
import { Share } from 'react-native';
import { Spacer, View, HStack, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import * as Clipboard from 'expo-clipboard';
import Modal from 'components/blocks/Modal';
import { PaymentInfo } from 'components/blocks/PaymentInfo';
import { useSelector } from 'react-redux';
import { showMessage, showSuccess } from 'helper/popup/popups';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import _ from 'lodash';
import { useNavigation } from 'expo-router';
import { useCashuUtilities, useMintManagement } from 'hooks/coco';
import { useTransactions } from 'providers/CocoTransactionsProvider';
import { Section } from 'components/ui/Section';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { TransactionHeader } from 'components/blocks/Transaction/TransactionHeader';
import { memoizedGetTheme } from 'helper/redux/settings';
import { truncateMiddle } from 'helper/strings';
import { Card } from 'components/ui/Card';
import { useTypedNavigation, useTypedRoute } from 'helper/navigation';

import type { ButtonHandlerButton } from 'components/ui/ButtonHandler';
import { greens, greys } from 'helper/colors';
import { MintQuoteResponse } from '@cashu/cashu-ts';
import { convertTime } from 'helper/time';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { TransactionMintRefresh } from 'components/blocks/Transaction/TransactionMintRefresh';
import Icon from 'assets/icons';
import { TransactionDebugCode } from 'components/blocks/Transaction/TransactionDebugCode';
import opacity from 'hex-color-opacity';
import { Essential } from 'helper/Essential';
import { useManager } from 'coco-cashu-react';

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
    any,
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
  const { getLightningExpiry: _getLightningExpiry } = useCashuUtilities();
  const theme = useSelector(memoizedGetTheme);
  const [collapsed, setCollapsed] = useState(false);
  const [_loading, _setLoading] = useState(false);
  const navigation = useTypedNavigation();

  const expiryDate = transaction?.request ? _getLightningExpiry(transaction.request) : null;
  const isExpired = expiryDate && new Date() > new Date(expiryDate * 1000);
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
            <HStack
              style={{
                marginVertical: 0,
              }}
              align="center">
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
                  marginVertical: barMarginVertical,
                  overflow: 'hidden',
                }}>
                <HStack align="center">
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
                        _loading
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
                </HStack>
              </TouchableOpacity>
            </HStack>

            {shouldCollapse && index === 0 && states.length > 2 && (
              <VStack
                style={{
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
              </VStack>
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
  autoGoBackOnPaid = true,
  extraButtons = [],
}: {
  request: string;
  paymentRequest?: string;
  unit: string;
  autoGoBackOnPaid?: boolean;
  extraButtons?: ButtonHandlerButton[];
}) {
  const { getMintInfo } = useMintManagement();
  const manager = useManager();
  const navigation = useNavigation();
  const theme = useSelector(memoizedGetTheme);
  const [uri, setUri] = useState<string | null>(null);
  const [mintInfo, setMintInfo] = useState<any>(null);

  const { history } = useTransactions();

  // Find the current transaction using Coco's transaction list
  const currentTransaction = history.find(
    (tx: any) => tx.paymentRequest === request && tx.unit === unit
  ) as any;

  // Load mint info when transaction is found
  useEffect(() => {
    if (currentTransaction?.mintUrl) {
      getMintInfo(currentTransaction.mintUrl)
        .then(setMintInfo)
        .catch(() => setMintInfo(null));
    }
  }, [currentTransaction?.mintUrl, getMintInfo]);

  // Set up Coco event subscription for Lightning invoice payment
  useEffect(() => {
    if (!currentTransaction || currentTransaction.paid || !manager) return;

    // Listen for mint quote state changes
    const unsubscribe = manager.on('mint-quote:state-changed', (payload) => {
      if (payload.quoteId === currentTransaction.mintQuote?.quote && payload.state === 'PAID') {
        showMessage('Lightning invoice paid!', {
          amount: currentTransaction.amount,
          unit: currentTransaction.unit,
        });
      }
    });

    return unsubscribe;
  }, [currentTransaction, manager]);

  // Auto-navigate back when payment is received
  useEffect(() => {
    if (autoGoBackOnPaid && currentTransaction?.paid) {
      const timer = setTimeout(() => {
        navigation.goBack();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [autoGoBackOnPaid, currentTransaction?.paid, navigation]);

  const handleCopy = async (close: (event: any) => void) => {
    await Clipboard.setStringAsync(request);
    showSuccess('lightning_address_copied', {}, {}, () => close({}));
  };

  const handleShare = async (close: (event: any) => void) => {
    if (uri) {
      await Share.share({ url: uri, message: request });
    }
    close({});
  };

  const handleCheckStatus = async (close: (event: any) => void) => {
    if (!currentTransaction) {
      showMessage('Transaction not found', {}, {}, () => close({}));
      return;
    }

    try {
      await getMintInfo(currentTransaction.mintUrl);
      showMessage('Status check completed', {}, {}, () => close({}));
    } catch {
      showMessage('Failed to check status', {}, {}, () => close({}));
    }
  };

  // Show loading state if transaction is not found
  if (!currentTransaction) {
    return (
      <Modal showClose title="Loading...">
        <View style={{ padding: 20, alignItems: 'center' }}>
          <Text>Loading transaction...</Text>
        </View>
      </Modal>
    );
  }

  const isBitcoin = unit === 'sat';
  const isPaid = currentTransaction.paid;

  return (
    <Modal
      showClose
      title={`Receive ${isBitcoin ? 'Bitcoin' : unit.toUpperCase()}`}
      buttons={
        <HStack style={{ paddingBottom: 8 }} justify="center" align="center">
          <ButtonHandler
            buttons={[
              {
                text: 'Copy',
                icon: 'lets-icons:copy',
                variant: 'primary',
                onPress: handleCopy,
                condition: !isPaid,
              },
              {
                text: 'Share',
                icon: 'ri:share-fill',
                variant: 'secondary',
                onPress: handleShare,
                condition: !isPaid,
              },
              {
                text: 'Check Status',
                icon: 'humbleicons:refresh',
                variant: 'secondary',
                onPress: handleCheckStatus,
                condition: !isPaid,
              },
              ...extraButtons.map((button) => ({ ...button, condition: !isPaid })),
            ]}
          />
        </HStack>
      }>
      <TransactionHeader
        transaction={{
          ...currentTransaction,
          unit,
          amount: currentTransaction.amount,
          transactionType: 'receive',
        }}
      />

      {!isPaid && !currentTransaction.fromNIP05 && (
        <PaymentInfo
          showSection={false}
          setUri={setUri}
          data={[{ name: 'Lightning', value: request }]}
          unit={unit}
          popupMessage={[{ name: 'lightning_address_copied' }]}
        />
      )}

      <Spacer size={12} />

      {currentTransaction.memo && (
        <>
          <View style={{ marginHorizontal: 16 }}>
            <Card message={currentTransaction.memo} variant="info" />
          </View>
          <Spacer size={12} />
        </>
      )}

      <TransactionMintRefresh
        mintInfo={mintInfo}
        transaction={{ ...currentTransaction, transactionType: 'receive' }}
        handleCheckStatus={handleCheckStatus}
      />
      <Spacer size={12} />

      <MintQuoteTimeline
        transaction={currentTransaction}
        type="mint"
        mintQuotes={currentTransaction.mintQuotes}
      />
      <Spacer size={12} />

      <Section
        special={false}
        items={[
          {
            title: 'Request',
            value: currentTransaction.fromNIP05
              ? truncateMiddle(currentTransaction.fromNIP05.split('@')[0], 4) +
                '@' +
                currentTransaction.fromNIP05.split('@')[1]
              : truncateMiddle(request, 10),
          },
          {
            title: 'Type',
            value: 'Lightning • Receive',
          },
          {
            title: 'Status',
            value: (
              <HStack align="center">
                <Text style={{ color: greys(theme)[0], fontSize: 16, fontFamily: 'OverpassBold' }}>
                  {isPaid ? 'Completed' : 'Pending'}
                </Text>
              </HStack>
            ),
          },
        ]}
      />
      <Spacer size={12} />

      <TransactionDebugCode transaction={currentTransaction} />
    </Modal>
  );
}

function ModalScreen() {
  const { request, unit } = useTypedRoute<'lightningReceiveConfirmation'>();

  return <LightningReceiveConfirmation request={request} unit={unit} />;
}

export default withSheetProvider(ModalScreen);
