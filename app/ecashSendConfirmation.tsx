import React, { useEffect, useState, createContext, useContext, useRef, useCallback } from 'react';
import { Share, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Button } from 'components/common/Button';
import { BalanceUpdate } from './transaction';
import Modal from 'components/layout/Modal';
import Icon from 'assets/icons';
import { SheetManager } from 'react-native-actions-sheet';
import { View, Text } from 'components/common/Themed';
import { PaymentInfo } from 'components/layout/PaymentInfo';
import { greys } from 'helper/colors';
import { formatCurrency } from 'helper/currency';
import { useSelector } from 'react-redux';
import { store } from 'helper/redux/store';
import {
  CashuMint,
  CashuWallet,
  getDecodedToken,
  getEncodedTokenV4,
  injectWebSocketImpl,
} from '@cashu/cashu-ts';
import _ from 'lodash';
import {
  memoizedGetTransactionByMatcher,
  memoizedGetTransactions,
  updateTransaction,
} from 'helper/redux/cashu';
import { cancelEcashTransaction, getWallet } from 'helper/cashu';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedNavigation, useTypedRoute } from 'helper/navigation';
import { showMessage, showSuccess } from 'helper/popup/popups';
import { write } from 'components/common/useNfc';
import { runWithAnimationFrame } from './onboard/new';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';
import Checkbox from 'expo-checkbox';
import {
  GestureHandlerRootView,
  NativeViewGestureHandler,
  Switch,
} from 'react-native-gesture-handler';
import { useTransactions } from 'components/providers/TransactionsProvider';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { Section } from 'components/common/Section';
import { npubToPubkey } from 'components/layout/Transaction';
import { encode } from 'helper/third-party/emoji';
import { withSheetProvider } from 'components/hocs/withSheetProvider';

function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const navigation = useTypedNavigation();
  const { unit, amount, token } = useTypedRoute<'ecashSendConfirmation'>();
  const [uri, setUri] = useState('');
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);

  const currentProfile = useSelector((state) => state.nostr?.currentProfile);

  const getCurrentTransaction = useSelector(
    memoizedGetTransactionByMatcher({
      profileId: currentProfile.id,
      matcher: (txs) =>
        _.filter(txs, {
          token,
          unit,
          amount,
          transactionType: 'send',
        }),
    })
  );

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

  const handleNFCSend = async () => {
    await write(token);
  };

  const handleCopy = async (onClose) => {
    await Clipboard.setStringAsync(token);
    showSuccess('ecash_token_copied', {}, {}, onClose);
  };

  const handleShare = async (onClose) => {
    await Share.share({
      url: uri,
      message: token,
    });
    onClose();
  };

  const handleCancelSend = async () => {
    try {
      const profileId = store.getState().nostr?.currentProfile?.id;
      const transactions = memoizedGetTransactions({ id: profileId })(store.getState());

      const transaction = transactions.find(
        (t) => t.token === token && t.transactionType === 'send'
      );

      await cancelEcashTransaction(transaction, navigation);
    } catch (error) {
      showMessage(error.message, {}, {}, onClose);
    }
  };

  const formattedToken = getEncodedTokenV4(getDecodedToken(token)) || token;
  const isLongToken = formattedToken.length >= 500;

  const isListening = activeConnections?.some(
    (connection) =>
      connection.id ===
      getCurrentTransaction[0].type +
        '_' +
        getCurrentTransaction[0].token +
        '_' +
        getCurrentTransaction[0].transactionType
  );

  const checkProofsSpent = async (token: string): Promise<boolean> => {
    try {
      const decodedToken = getDecodedToken(token);
      const { unit, mint: mintUrl, proofs } = decodedToken;

      const wallet = await getWallet({
        unit,
        mintUrl,
        profile: null,
      });

      if (!wallet) {
        throw new Error('Failed to initialize wallet');
      }

      const spentProofs = await wallet.checkProofsStates(proofs);

      if (spentProofs.some((p) => p.state === 'SPENT')) {
        // Update transaction state
        const profileId = store.getState().nostr?.currentProfile?.id;
        await store.dispatch(
          updateTransaction({
            profileId,
            matcher: (tx) => tx.token === token,
            updateFn: (tx) => ({
              ...tx,
              paid: true,
            }),
          })
        );

        return true; // Proofs are spent
      }

      return false; // Proofs are not spent
    } catch (error) {
      throw error;
    }
  };

  const handleCheckStatus = async (onClose) => {
    if (isCheckingStatus) return;

    try {
      setIsCheckingStatus(true);
      const proofsSpent = await checkProofsSpent(token);
      console.log(18279387, proofsSpent);

      if (proofsSpent) {
        const decodedToken = getDecodedToken(token);
        const amount = _.sumBy(decodedToken.proofs, 'amount');

        showMessage('funds_sent', { amount, unit }, { emoji: '🎉' }, () => {
          navigation.navigate(
            'index',
            {},
            {
              closeParents: true,
            }
          );
          onClose();
        });
      } else {
        showMessage('ecash_transaction_pending', {}, { emoji: '❌' }, onClose);
      }
    } catch (error) {
      console.log(18279387, error);
      showMessage('error_checking_status', { error: error.message }, { emoji: '⚠️' }, onClose);
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const handleCopyEmoji = async (onClose) => {
    SheetManager.show('emoji-picker', {
      payload: {
        token,
      },
      onClose,
    });
  };

  return (
    <Modal
      showClose
      children={
        <>
          <BalanceUpdate
            pubkey={npubToPubkey(getCurrentTransaction[0]?.nostr?.pubkey)}
            transactionType="send"
            topAmount={formatCurrency(
              {
                currency: unit === 'sat' ? 'BTC' : unit.toUpperCase(),
                value: amount,
                denomination: unit === 'sat' ? 'sats' : unit,
              },
              {
                locale: 'en-US',
                precision: unit === 'sat' ? 8 : 2,
                currencyDisplay: 'symbol',
                denomination: unit === 'sat' ? 'btc' : unit,
              }
            )}
            bottomAmount={formatCurrency(
              {
                currency: unit === 'sat' ? 'BTC' : unit.toUpperCase(),
                value: amount,
                denomination: unit === 'sat' ? 'sats' : unit,
              },
              {
                locale: 'en-US',
                precision: 2,
                currencyDisplay: 'symbol',
                denomination: unit === 'sat' ? 'usd' : unit,
              }
            )}
          />
          <PaymentInfo
            setUri={setUri}
            popupMessage="ecash_token_copied"
            unit={unit}
            data={formattedToken}
            animated={isLongToken}
          />
          <Section
            items={[
              {
                title: 'Listening',
                value: String(isListening),
              },
            ]}
          />
          {/* <Text>{JSON.stringify(getCurrentTransaction?.[0], null, 2)}</Text> */}
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
                text: 'NFC',
                icon: 'ph:contactless-payment-fill',
                variant: 'secondary',
                onPress: handleNFCSend,
              },
              {
                text: 'Check Status',
                icon: 'humbleicons:refresh',
                variant: 'secondary',
                onPress: handleCheckStatus,
              },
              {
                text: 'Cancel Transaction',
                icon: 'mdi:cancel',
                variant: 'secondary',
                onPress: handleCancelSend,
              },
              {
                text: 'Copy as Emoji',
                icon: 'fluent:emoji-24-filled',
                variant: 'primary',
                onPress: handleCopyEmoji,
              },
            ]}
          />
        </View>
      }
    />
  );
}

const createStyles = (theme) =>
  StyleSheet.create({
    container: {
      backgroundColor: greys(theme)[2300],
    },
    title: {
      fontSize: 20,
      fontWeight: 'bold',
      color: greys(theme)[1000],
    },
  });

export default withSheetProvider(ModalScreen);
