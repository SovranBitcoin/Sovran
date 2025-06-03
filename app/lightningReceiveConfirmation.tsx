import React, { useEffect, useState } from 'react';
import { Share, Text } from 'react-native';
import { View } from 'components/common/Themed';
import { Spinner } from 'components/common/Spinner';
import * as Clipboard from 'expo-clipboard';
import Modal from 'components/layout/Modal';
import { PaymentInfo } from 'components/layout/PaymentInfo';
import { useSelector } from 'react-redux';
import { showMessage, showSuccess } from 'helper/popup/popups';
import { ButtonHandler } from 'components/common/ButtonHandler';
import _ from 'lodash';
import {
  memoizedGetTransactionByMatcher,
  updateTransaction,
  useGetMintInfo,
} from 'helper/redux/cashu';
import { useNavigation } from 'expo-router';
import { useTransactions } from 'components/providers/TransactionsProvider';
import { getWallet } from 'helper/cashu';
import { store } from 'helper/redux/store';
import { Section } from 'components/common/Section';
import { withSheetProvider } from 'components/hocs/withSheetProvider';
import { BalanceUpdate } from 'components/common/BalanceUpdate';
import { memoizedGetTheme } from 'helper/redux/settings';
import { MintDetailPage } from './ecashSendConfirmation';
import { truncateMiddle } from 'helper/strings';
import { Card } from 'components/common/Card';
import { useTypedRoute } from 'helper/navigation';

import type { ButtonHandlerButton } from 'components/common/ButtonHandler';
import { greys } from 'helper/colors';

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
  const currentProfile = useSelector((state) => state.nostr.currentProfile);

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

  const handleCheckStatus = async (onClose) => {
    const currentTx = getCurrentTransaction[0];
    const wallet = await getWallet({
      unit: currentTx.unit,
      mintUrl: currentTx.mintUrl,
      profile: null,
    });
    const status = await wallet.checkMintQuote(currentTx.mintQuote?.quote);

    if (status.state === 'PAID' || status.state === 'ISSUED') {
      const profileId = store.getState().nostr?.currentProfile?.id;
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
    } else {
      showMessage('lightning_transaction_pending', {}, { emoji: '❌' }, onClose);
    }
  };

  const mintInfo = useGetMintInfo({ mintUrl: getCurrentTransaction[0].mintUrl });

  return (
    <Modal
      showClose
      title={`Receive ${isBitcoin ? 'Bitcoin' : unit.toUpperCase()}`}
      children={
        <>
          <BalanceUpdate transactionType="receive" amount={amount} unit={unit} />
          {!getCurrentTransaction[0].paid && (
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
          <MintDetailPage
            mintInfo={mintInfo}
            getCurrentTransaction={getCurrentTransaction}
            theme={theme}
            transactionType="receive"
          />
          <Section
            items={[
              {
                title: 'Request',
                value: truncateMiddle(request, 10),
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
