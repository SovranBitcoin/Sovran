import React, { useEffect, useState } from 'react';
import { Share, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Button } from 'components/common/Button';
import { BalanceUpdate } from './transaction';
import Modal from 'components/layout/Modal';
import Icon from 'assets/icons';
import { SheetManager } from 'react-native-actions-sheet';
import { View } from 'components/common/Themed';
import { PaymentInfo } from 'components/layout/PaymentInfo';
import { greys } from 'helper/colors';
import { formatCurrency } from 'helper/currency';
import { useSelector } from 'react-redux';
import { store } from 'helper/redux/store';
import { getDecodedToken, getEncodedTokenV4 } from '@cashu/cashu-ts';
import _ from 'lodash';
import withConfirmation from 'components/layout/ConfirmationProvider';
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

// Standalone function to check if proofs are spent
export const checkProofsSpent = async (token: string): Promise<boolean> => {
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

interface ProofCheckResult {
  spentProofs: any[];
  error?: Error;
}

export const useCheckProofsSpent = (
  tokens: string[],
  delayMs = 3000,
  callback: () => void
): ProofCheckResult => {
  const [result, setResult] = useState<ProofCheckResult>({ spentProofs: [] });

  useEffect(() => {
    const abortController = new AbortController();
    const signal = abortController.signal;

    const poll = async () => {
      for (const token of tokens) {
        if (signal.aborted) break;

        try {
          const proofsSpent = await checkProofsSpent(token);

          if (proofsSpent) {
            const decodedToken = getDecodedToken(token);
            const unit = decodedToken.unit;
            const amount = _.sumBy(decodedToken.proofs, 'amount');

            if (callback) {
              showMessage('funds_sent', { amount, unit }, { emoji: '🎉' }, callback);
            }

            break;
          }
        } catch (error) {
          setResult({ spentProofs: [], error: error as Error });
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    };

    poll();

    return () => {
      abortController.abort();
    };
  }, [tokens, delayMs, callback]);

  return result;
};

import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';

export function ButtonHandler({ context, buttons, style = {}, colors }) {
  const [loading, setLoading] = useState(false);
  const theme = useSelector(memoizedGetTheme);

  return (
    <LinearGradient
      colors={
        colors || [
          opacity(greys(theme)[2300], 0),
          opacity(greys(theme)[2300], 0.75),
          opacity(greys(theme)[2300], 0.9),
          greys(theme)[2300],
        ]
      }
      style={{
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 8,
        paddingBottom: 16,
        marginBottom: context === 'tab' ? 48 : 0,
        ...style,
      }}>
      {buttons.slice(0, 2).map((button, index) => (
        <View
          key={index}
          style={{
            flex: 1,
            backgroundColor: 'transparent',
          }}>
          <Button
            position="center"
            onPress={() => {
              // Only run the onPress if the button is not disabled
              if (!button.disabled) {
                runWithAnimationFrame(button.onPress, setLoading)();
              }
            }}
            text={button.text}
            variant={button.variant}
            loading={loading || button.loading}
            disabled={button.disabled} // Pass the disabled prop to Button
            icon={button.icon}
          />
        </View>
      ))}

      {buttons.length > 2 && (
        <View
          style={{
            backgroundColor: 'transparent',
            width: 64,
          }}>
          <Button
            icon={<Icon name={'tabler:dots'} />}
            onPress={() => {
              SheetManager.show('button-handler', {
                payload: { buttons },
              });
            }}
            variant="secondary"
            loading={loading}
          />
        </View>
      )}
    </LinearGradient>
  );
}

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

  // Auto-navigate when transaction is paid
  useEffect(() => {
    if (getCurrentTransaction?.[0]?.paid) {
      const timer = setTimeout(() => {
        navigation.goBack();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [getCurrentTransaction, navigation]);

  const handleNFCSend = async () => {
    await write(token);
  };

  const handleCopy = async () => {
    showSuccess('ecash_token_copied', {});
    await Clipboard.setStringAsync(token);
  };

  const handleShare = async () => {
    await Share.share({
      url: uri,
      message: token,
    });
  };

  const handleCancelSend = async () => {
    const profileId = store.getState().nostr?.currentProfile?.id;
    const transactions = memoizedGetTransactions({ id: profileId })(store.getState());

    const transaction = transactions.find((t) => t.token === token && t.transactionType === 'send');

    await cancelEcashTransaction(transaction, navigation);
  };

  const handleCheckStatus = async () => {
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
        });
      } else {
        showMessage('ecash_transaction_pending', {}, { emoji: '❌' });
      }
    } catch (error) {
      showMessage('error_checking_status', { error: error.message }, { emoji: '⚠️' });
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const formattedToken = getEncodedTokenV4(getDecodedToken(token)) || token;
  const isLongToken = formattedToken.length >= 500;

  return (
    <Modal
      showClose
      children={
        <>
          <BalanceUpdate
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
            ]}
          />
        </View>
      }
    />
  );
}

export default withConfirmation(ModalScreen);

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
