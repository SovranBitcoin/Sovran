import React, { useEffect, useState, createContext, useContext, useRef, useCallback } from 'react';
import { Share, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Button } from 'components/common/Button';
import Modal from 'components/layout/Modal';
import Icon from 'assets/icons';
import { Spinner } from 'components/common/Spinner';
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
import _, { capitalize } from 'lodash';
import {
  memoizedGetTransactionByMatcher,
  memoizedGetTransactions,
  updateTransaction,
  useGetMintInfo,
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
import { BalanceUpdate } from 'components/common/BalanceUpdate';
import { convertTime } from 'helper/time';
import { truncateMiddle } from 'helper/strings';
import { MintIcon } from 'components/layout/sheets/mints';
import { Card } from 'components/common/Card';

export function MintDetailPage({
  mintInfo,
  theme,
  transactionType,
}: {
  mintInfo: any;
  theme: any;
  transactionType: 'send' | 'receive';
}) {
  return (
    <View
      style={{
        margin: 16,
        marginTop: 8,
        padding: 16,
        marginBottom: 0,
        borderRadius: 8,
        backgroundColor: greys(theme)[1800],
        flexDirection: 'row',
      }}>
      <View>
        <MintIcon size={40} mintInfo={mintInfo} />
      </View>
      <View>
        <Text
          style={{
            fontFamily: 'OverpassHeavy',
            fontSize: 16,
          }}>
          {transactionType === 'send' ? 'Sending with' : 'Receiving with'}
        </Text>
        <Text
          style={{
            fontFamily: 'OverpassRegular',
            fontSize: 16,
            color: greys(theme)[100],
          }}>
          {mintInfo?.name}
        </Text>
      </View>
    </View>
  );
}

import type { ButtonHandlerButton } from 'components/common/ButtonHandler';

export function EcashSendConfirmation({
  unit,
  amount,
  token,
  extraButtons = [],
}: {
  unit: string;
  amount: number;
  token: string;
  extraButtons?: ButtonHandlerButton[];
}) {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const navigation = useTypedNavigation();
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

  const handleCancelSend = async (onClose) => {
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
    (connection) => connection.id === getCurrentTransaction[0].token
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
  const mintInfo = useGetMintInfo({ mintUrl: getCurrentTransaction[0].mintUrl });
  return (
    <Modal
      showClose
      children={
        <>
          <BalanceUpdate
            pubkey={npubToPubkey(getCurrentTransaction[0]?.nostr?.pubkey)}
            transactionType="send"
            amount={amount}
            unit={unit}
          />
          {!getCurrentTransaction[0].paid && (
            <PaymentInfo
              setUri={setUri}
              popupMessage="ecash_token_copied"
              unit={unit}
              data={formattedToken}
              animated={isLongToken}
              showSection={false}
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
          <MintDetailPage mintInfo={mintInfo} theme={theme} transactionType="send" />
          <Section
            items={[
              {
                title: 'Date',
                value: convertTime(new Date(getCurrentTransaction[0]?.date)),
              },
              {
                title: 'Type',
                value:
                  capitalize(String(getCurrentTransaction[0]?.type)) +
                  ' • ' +
                  capitalize(String(getCurrentTransaction[0]?.transactionType)),
              },
              {
                title: 'Status',
                value: (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text
                      style={{
                        color: greys(theme)[0],
                        fontFamily: 'OverpassBold',
                        fontSize: 16,
                      }}>
                      {getCurrentTransaction[0].paid ? 'Completed' : 'Pending'}
                    </Text>
                    {isListening && <Spinner style={{ marginLeft: 4 }} size={12} />}
                  </View>
                ),
              },
              {
                title: 'Token',
                value: truncateMiddle(token, 6),
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
            buttons={
              getCurrentTransaction[0].paid
                ? [
                    {
                      text: 'Close',
                      icon: 'ri:close-circle-line',
                      variant: 'secondary',
                      onPress: () => navigation.goBack(),
                    },
                    ...(getCurrentTransaction[0].nostr?.pubkey
                      ? [
                          {
                            text: 'View Messages',
                            icon: 'mdi:message-reply',
                            variant: 'primary',
                            onPress: () => {
                              navigation.navigate('userMessages', {
                                pubkey: getCurrentTransaction[0].nostr.pubkey,
                              });
                              navigation.goBack();
                            },
                          },
                        ]
                      : []),
                  ]
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
                    ...extraButtons,
                  ]
            }
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

function ModalScreen() {
  const { unit, amount, token } = useTypedRoute<'ecashSendConfirmation'>();
  return <EcashSendConfirmation unit={unit} amount={amount} token={token} />;
}

export default withSheetProvider(ModalScreen);
