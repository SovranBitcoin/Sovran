import React, { useEffect, useState } from 'react';
import { Share, Text } from 'react-native';
import { View } from 'components/common/Themed';
import * as Clipboard from 'expo-clipboard';
import { BalanceUpdate } from './transaction';
import Modal from 'components/layout/Modal';
import { formatCurrency } from 'helper/currency';
import { PaymentInfo } from 'components/layout/PaymentInfo';
import { useTypedRoute } from 'helper/navigation';
import { useSelector } from 'react-redux';
import { showMessage, showSuccess } from 'helper/popup/popups';
import { ButtonHandler } from 'components/common/ButtonHandler';
import _ from 'lodash';
import { memoizedGetTransactionByMatcher, updateTransaction } from 'helper/redux/cashu';
import { useNavigation } from 'expo-router';
import { useTransactions } from 'components/providers/TransactionsProvider';
import { getMint, getWallet } from 'helper/cashu';
import { store } from 'helper/redux/store';
import { Section } from 'components/common/Section';

function ModalScreen() {
  const navigation = useNavigation();
  const {
    request,
    paymentRequest = '',
    unit,
    amount,
  } = useTypedRoute<'lightningReceiveConfirmation'>();
  const [uri, setUri] = useState(null);
  const currentProfile = useSelector((state) => state.nostr.currentProfile);

  const getCurrentTransaction = useSelector(
    memoizedGetTransactionByMatcher({
      profileId: currentProfile.id,
      matcher: (txs) =>
        _.filter(txs, {
          request: request,
          type: 'lightning',
          unit: unit,
          amount: amount,
        }),
    })
  );

  // Auto-navigate back when payment is received
  useEffect(() => {
    if (getCurrentTransaction?.[0]?.paid) {
      const timer = setTimeout(() => {
        navigation.goBack();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [getCurrentTransaction[0]?.paid, navigation]);

  const handleCopy = async () => {
    showSuccess('lightning_address_copied', {});
    await Clipboard.setStringAsync(request);
  };

  const handleShare = async () => {
    if (uri) {
      await Share.share({
        url: uri,
        message: request,
      });
    }
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

  const {
    transactions,
    listenToTransaction,
    stopListening,
    getActiveConnections,
    activeConnections,
  } = useTransactions();

  useEffect(() => {
    if (getCurrentTransaction?.[0]) {
      listenToTransaction(getCurrentTransaction?.[0]);
    }
  }, [getCurrentTransaction?.[0]]);

  const isListening = activeConnections?.some(
    (connection) =>
      connection.id ===
      getCurrentTransaction[0].type +
        '_' +
        getCurrentTransaction[0].request +
        '_' +
        getCurrentTransaction[0].transactionType
  );

  const handleCheckStatus = async () => {
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
        { emoji: '🎉' }
      );
    } else {
      showMessage('lightning_transaction_pending', {}, { emoji: '❌' });
    }
  };

  return (
    <Modal
      showClose
      title={`Receive ${isBitcoin ? 'Bitcoin' : unit.toUpperCase()}`}
      children={
        <>
          <BalanceUpdate
            transactionType="receive"
            topAmount={formatCurrency(getCurrencyData(), getCurrencyOptions('btc'))}
            bottomAmount={formatCurrency(
              getCurrencyData(),
              getCurrencyOptions(isBitcoin ? 'usd' : unit)
            )}
          />
          <PaymentInfo
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
          <Section
            items={[
              {
                title: 'Listening',
                value: String(isListening),
              },
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
            buttons={[
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
            ]}
          />
        </View>
      }
    />
  );
}

export default ModalScreen;
