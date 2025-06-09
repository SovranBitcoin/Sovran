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
  appendProofsV2,
  increaseCounterV2,
  memoizedGetCounterV2,
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
import { publishWalletEvent } from 'helper/nostr/cashu';

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
      console.log(12837, status);
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
        publishWalletEvent([
          ...new Set([
            ...store
              .getState()
              .cashu?.profiles?.[
                store.getState().nostr.currentProfile.id
              ]?.transactions.map((t) => t.mintUrl),
            currentTx.mintUrl,
          ]),
        ]);

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
      console.log(error.message);
      if (error.message === 'keyset id inactive.') {
        handleCheckStatus(onClose, true);
      } else {
      }
    }
  };

  const mintInfo = useGetMintInfo({ mintUrl: getCurrentTransaction[0].mintUrl });

  console.log('getCurrentTransaction22', getCurrentTransaction[0]);

  return (
    <Modal
      showClose
      title={`Receive ${isBitcoin ? 'Bitcoin' : unit.toUpperCase()}`}
      children={
        <>
          <BalanceUpdate transactionType="receive" amount={amount} unit={unit} />
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
          <MintDetailPage
            mintInfo={mintInfo}
            transaction={getCurrentTransaction}
            theme={theme}
            transactionType="receive"
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
