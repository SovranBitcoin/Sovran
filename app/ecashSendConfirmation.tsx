import React, { useState, useEffect } from 'react';
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Modal from 'components/blocks/Modal';
import { Spinner } from 'components/ui/Spinner';
import { SheetManager } from 'react-native-actions-sheet';
import { View, Spacer, HStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { PaymentInfo } from 'components/blocks/PaymentInfo';
import { greys } from 'helper/colors';
import { useSelector } from 'react-redux';
import {
  getDecodedToken,
  getEncodedTokenV4,
  decodePaymentRequest,
  PaymentRequestTransportType,
} from '@cashu/cashu-ts';
import { nip19 } from 'nostr-tools';
import { sendGiftWrappedEncryptedDirectMessage } from 'helper/nostrClient';
import _, { capitalize } from 'lodash';
// Removed memoizedGetTransactionByMatcher - now using Coco transactions
import { useCashuOperations, useMintManagement } from 'hooks/coco';
import { useSend, useManager } from 'coco-cashu-react';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedNavigation, useTypedRoute } from 'helper/navigation';
import { showMessage, showSuccess } from 'helper/popup/popups';
import { write } from 'helper/nfc';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { Section } from 'components/ui/Section';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { TransactionHeader } from 'components/blocks/Transaction/TransactionHeader';
import { convertTime } from 'helper/time';
import { truncateMiddle } from 'helper/strings';
import { Card } from 'components/ui/Card';

import type { ButtonHandlerButton } from 'components/ui/ButtonHandler';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { MintQuoteTimeline } from './lightningReceiveConfirmation';
import { TransactionMintRefresh } from 'components/blocks/Transaction/TransactionMintRefresh';
import { TransactionDebugCode } from 'components/blocks/Transaction/TransactionDebugCode';
import { err, ok, Result } from 'neverthrow';

export function EcashSendConfirmation({
  unit,
  amount,
  token,
  paymentRequest,
  extraButtons = [],
}: {
  unit: string;
  amount: number;
  token: string;
  paymentRequest?: string;
  extraButtons?: ButtonHandlerButton[];
}) {
  const { isTokenSpendable, receiveEcash } = useCashuOperations();
  const { getMintInfo: _getMintInfo } = useMintManagement();
  const { send, isSending } = useSend();
  const manager = useManager();
  const theme = useSelector(memoizedGetTheme);
  const navigation = useTypedNavigation();
  const [uri, setUri] = useState('');
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [sendingNostr, setSendingNostr] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const currentProfile = useSelector(memoizedGetCurrentProfile);

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

  // Set up Coco event subscription for ecash token spending
  useEffect(() => {
    const currentTx = getCurrentTransaction[0];
    if (!currentTx || currentTx.paid || !manager) return;

    setIsListening(true);

    // Listen for proof state changes (when ecash token gets spent)
    const unsubscribe = manager.on('proofs:state-changed', (payload) => {
      // Check if this transaction's token has been spent
      const decodedToken = getDecodedToken(token);
      if (decodedToken && payload.mintUrl === decodedToken.mint) {
        const tokenSecrets = decodedToken.proofs.map((p) => p.secret);
        const hasMatchingSecrets = tokenSecrets.some((secret) => payload.secrets.includes(secret));

        if (hasMatchingSecrets && payload.state === 'spent') {
          // Coco automatically updates transaction status
          showMessage('Ecash token spent!', { amount: currentTx.amount, unit: currentTx.unit });
          setIsListening(false);
        }
      }
    });

    return () => {
      unsubscribe();
      setIsListening(false);
    };
  }, [getCurrentTransaction, manager, currentProfile.id, token]);

  const resolvedPaymentRequest = paymentRequest || getCurrentTransaction[0]?.paymentRequest;

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
      message: 'cashu://' + token,
    });
    onClose();
  };

  const handleSendNostr = async () => {
    const request = resolvedPaymentRequest;
    if (!request) return;
    try {
      setSendingNostr(true);
      const decoded = decodePaymentRequest(request);
      const receiverTarget = decoded.getTransport(PaymentRequestTransportType.NOSTR).target;
      const { data } = nip19.decode(receiverTarget);
      const { pubkey } = data as { pubkey: string };

      const decodedToken = getDecodedToken(token);

      await sendGiftWrappedEncryptedDirectMessage({
        message: JSON.stringify({
          mint: decodedToken.mint,
          unit: decodedToken.unit,
          proofs: decodedToken.proofs,
          id: decoded.id,
        }),
        recipient: pubkey,
        nsec: currentProfile.nsec,
      });
    } finally {
      setSendingNostr(false);
    }
  };

  const handleCancelSend = async (onClose) => {
    try {
      // For ecash transactions, "cancelling" means receiving the token back
      // This effectively cancels the send transaction
      await receiveEcash(token);
      showMessage('Transaction cancelled successfully', {}, {}, onClose);
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : 'Failed to cancel transaction',
        {},
        {},
        onClose
      );
    }
  };

  const handleSendEcash = async (onClose) => {
    try {
      const decodedToken = getDecodedToken(token);
      const mintUrl = decodedToken.mint;

      // Use Coco's send function to send ecash
      await send(mintUrl, amount);
      showMessage('Ecash sent successfully!', { amount, unit }, { emoji: '🎉' }, onClose);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Failed to send ecash', {}, {}, onClose);
    }
  };

  const formattedToken = getEncodedTokenV4(getDecodedToken(token)) || token;
  const isLongToken = formattedToken.length >= 500;

  const checkProofsSpent = async (token: string): Promise<Result<boolean, Error>> => {
    try {
      const isSpendable = await isTokenSpendable(token);
      return ok(!isSpendable); // Return true if NOT spendable (i.e., spent)
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Failed to check proof states'));
    }
  };

  const handleCheckStatus = async (onClose) => {
    if (isCheckingStatus) return;

    setIsCheckingStatus(true);
    const result = await checkProofsSpent(token);

    if (result.isOk()) {
      const proofsSpent = result.value;
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
    } else {
      showMessage(
        'error_checking_status',
        { error: result.error.message },
        { emoji: '⚠️' },
        onClose
      );
    }
    setIsCheckingStatus(false);
  };

  const handleCopyEmoji = async (onClose) => {
    SheetManager.show('emoji-picker', {
      payload: {
        token,
      },
      onClose,
    });
  };

  const { getMintInfo } = useMintManagement();
  const [mintInfo, setMintInfo] = React.useState<any>({});

  // Load mint info when transaction changes
  React.useEffect(() => {
    const loadMintInfo = async () => {
      if (getCurrentTransaction[0]?.mintUrl) {
        try {
          const info = await getMintInfo(getCurrentTransaction[0].mintUrl);
          setMintInfo(info);
        } catch (error) {
          console.error('Failed to load mint info:', error);
          setMintInfo({});
        }
      } else {
        setMintInfo({});
      }
    };
    loadMintInfo();
  }, [getCurrentTransaction, getMintInfo]);

  return (
    <Modal
      showClose
      buttons={
        <HStack className="pb-2" justify="center" align="center">
          <ButtonHandler
            buttons={[
              {
                text: 'Close',
                icon: 'ri:close-circle-line',
                variant: 'secondary',
                onPress: async () => navigation.goBack(),
                condition: getCurrentTransaction[0].paid,
              },
              {
                text: 'View Messages',
                icon: 'mdi:message-reply',
                variant: 'primary',
                onPress: async () => {
                  navigation.navigate('userMessages', {
                    pubkey: getCurrentTransaction[0].nostr.pubkey,
                  });
                  navigation.goBack();
                },
                condition: !!(
                  getCurrentTransaction[0].paid && getCurrentTransaction[0].nostr?.pubkey
                ),
              },
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
                text: 'NFC',
                icon: 'ph:contactless-payment-fill',
                variant: 'secondary',
                onPress: handleNFCSend,
                condition: !getCurrentTransaction[0].paid,
              },
              {
                text: 'Send via Nostr',
                icon: 'mdi:send',
                variant: 'primary',
                loading: sendingNostr,
                onPress: handleSendNostr,
                condition: !!(resolvedPaymentRequest && !getCurrentTransaction[0].paid),
              },
              {
                text: 'Copy as Emoji',
                icon: 'fluent:emoji-24-filled',
                variant: 'primary',
                onPress: handleCopyEmoji,
                condition: !getCurrentTransaction[0].paid,
              },
              {
                text: 'Send Ecash',
                icon: 'mdi:send',
                variant: 'primary',
                loading: isSending,
                onPress: handleSendEcash,
                condition: !getCurrentTransaction[0].paid,
              },
              {
                text: 'Cancel Transaction',
                icon: 'mdi:cancel',
                variant: 'dangerous',
                onPress: handleCancelSend,
                condition: !getCurrentTransaction[0].paid,
              },
              ...extraButtons.map((button) => ({
                ...button,
                condition: !getCurrentTransaction[0].paid,
              })),
            ]}
          />
        </HStack>
      }>
      <TransactionHeader
        transaction={{ ...getCurrentTransaction[0], unit, amount, transactionType: 'send' }}
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
        transaction={{
          ...getCurrentTransaction[0],
          unit,
          amount,
          transactionType: 'send',
        }}
        mintInfo={mintInfo}
        handleCheckStatus={handleCheckStatus}
      />
      <Spacer size={12} />

      <MintQuoteTimeline
        transaction={{
          ...getCurrentTransaction[0],
          unit,
          amount,
          transactionType: 'send',
        }}
        meltQuotes={getCurrentTransaction[0].proofStates}
      />
      <Spacer size={12} />
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
              <HStack align="center">
                <Text
                  style={{
                    color: greys(theme)[0],
                    fontFamily: 'OverpassBold',
                    fontSize: 16,
                  }}>
                  {getCurrentTransaction[0].paid ? 'Completed' : 'Pending'}
                </Text>
                {isListening && <Spinner style={{ marginLeft: 4 }} size={12} />}
              </HStack>
            ),
          },
          {
            title: 'Token',
            value: truncateMiddle(token, 6),
          },
        ]}
      />
      <Spacer size={12} />
      <TransactionDebugCode transaction={getCurrentTransaction[0]} />
    </Modal>
  );
}

function ModalScreen() {
  const { unit, amount, token, paymentRequest } = useTypedRoute<'ecashSendConfirmation'>();
  return (
    <EcashSendConfirmation
      unit={unit}
      amount={amount}
      token={token}
      paymentRequest={paymentRequest}
    />
  );
}

export default withSheetProvider(ModalScreen);
