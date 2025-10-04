import React, { useState, useEffect } from 'react';
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Modal from 'components/blocks/Modal';
import { SheetManager } from 'react-native-actions-sheet';
import { HStack, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { PaymentInfo } from 'components/blocks/PaymentInfo';
import { greys } from 'helper/colors';
import { useSelector } from 'react-redux';
import {
  getEncodedTokenV4,
  decodePaymentRequest,
  PaymentRequestTransportType,
  GetInfoResponse,
  Token,
} from '@cashu/cashu-ts';
import { nip19 } from 'nostr-tools';
import { sendGiftWrappedEncryptedDirectMessage } from 'helper/nostrClient';
import { useCashuOperations, useMintManagement } from 'hooks/coco';
import { useSend, usePaginatedHistory } from 'coco-cashu-react';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useLocalSearchParams, router } from 'expo-router';
import { showMessage, showSuccess } from 'helper/popup/popups';
import { write } from 'helper/nfc';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { Section } from 'components/ui/Section';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { TransactionHeader } from 'components/blocks/Transaction/TransactionHeader';
import { convertTime } from 'helper/time';
import { truncateMiddle } from 'helper/strings';

import type { ButtonHandlerButton } from 'components/ui/ButtonHandler';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { TransactionMintRefresh } from 'components/blocks/Transaction/TransactionMintRefresh';
import { TransactionDebugCode } from 'components/blocks/Transaction/TransactionDebugCode';
import { err, ok, Result } from 'neverthrow';
import { MintQuoteTimeline } from './lightningReceiveConfirmation';

export function EcashSendConfirmation({
  unit,
  amount,
  token,
  paymentRequest,
  extraButtons = [],
}: {
  unit: string;
  amount: number;
  token: Token;
  paymentRequest?: string;
  extraButtons?: ButtonHandlerButton[];
}) {
  const { isTokenSpendable, receiveEcash } = useCashuOperations();
  const { getMintInfo } = useMintManagement();
  const { send, isSending } = useSend();
  const theme = useSelector(memoizedGetTheme);
  const [uri, setUri] = useState('');
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [sendingNostr, setSendingNostr] = useState(false);
  const [mintInfo, setMintInfo] = useState<GetInfoResponse | null>(null);

  const currentProfile = useSelector(memoizedGetCurrentProfile);
  const { history } = usePaginatedHistory();

  // Find the current transaction using coco's history system
  const currentTransaction = history.find((tx) => {
    return tx.type === 'send' && getEncodedTokenV4(tx.token) === getEncodedTokenV4(token);
  });

  // Load mint info when transaction is found
  useEffect(() => {
    const loadMintInfo = async () => {
      if (currentTransaction?.mintUrl) {
        try {
          const info = await getMintInfo(currentTransaction.mintUrl);
          setMintInfo(info);
        } catch (error) {
          console.error('Failed to load mint info:', error);
          setMintInfo(null);
        }
      }
    };
    loadMintInfo();
  }, [currentTransaction?.mintUrl, getMintInfo]);

  const resolvedPaymentRequest =
    paymentRequest ||
    (currentTransaction && 'paymentRequest' in currentTransaction
      ? currentTransaction.paymentRequest
      : undefined);

  const handleNFCSend = async () => {
    await write(getEncodedTokenV4(token));
  };

  const handleCopy = async (onClose: (event: any) => void) => {
    await Clipboard.setStringAsync(getEncodedTokenV4(token));
    showSuccess('ecash_token_copied', {}, {}, () => onClose({}));
  };

  const handleShare = async (onClose: (event: any) => void) => {
    await Share.share({
      url: uri,
      message: 'cashu://' + getEncodedTokenV4(token),
    });
    onClose({});
  };

  const handleSendNostr = async () => {
    const request = resolvedPaymentRequest;
    if (!request) return;
    try {
      setSendingNostr(true);
      const decoded = decodePaymentRequest(request);
      const receiverTarget = decoded.getTransport(PaymentRequestTransportType.NOSTR)?.target;
      if (!receiverTarget) return;
      const { data } = nip19.decode(receiverTarget);
      const { pubkey } = (data as { pubkey: string }) || { pubkey: '' };

      if (!token) {
        showMessage('Invalid token format', {}, {}, () => {});
        return;
      }

      await sendGiftWrappedEncryptedDirectMessage({
        message: JSON.stringify({
          mint: token.mint,
          unit: token.unit,
          proofs: token.proofs,
          id: decoded.id,
        }),
        recipient: pubkey,
        nsec: currentProfile.nsec,
      });
    } catch (error) {
      console.error('Failed to send via Nostr:', error);
      showMessage('Failed to send via Nostr', {}, {}, () => {});
    } finally {
      setSendingNostr(false);
    }
  };

  const handleCancelSend = async (onClose: (event: any) => void) => {
    try {
      // For ecash transactions, "cancelling" means receiving the token back
      // This effectively cancels the send transaction
      await receiveEcash(getEncodedTokenV4(token));
      showMessage('Transaction cancelled successfully', {}, {}, () => onClose({}));
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : 'Failed to cancel transaction',
        {},
        {},
        () => onClose({})
      );
    }
  };

  const handleSendEcash = async (onClose: (event: any) => void) => {
    try {
      if (!token) {
        showMessage('Invalid token format', {}, {}, () => onClose({}));
        return;
      }
      const mintUrl = token.mint;

      // Use Coco's send function to send ecash
      await send(mintUrl, amount);
      showMessage('Ecash sent successfully!', { amount, unit }, { emoji: '🎉' }, () => onClose({}));
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Failed to send ecash', {}, {}, () =>
        onClose({})
      );
    }
  };

  // Safely format the token
  const getFormattedToken = (): string => {
    try {
      return getEncodedTokenV4(token);
    } catch (error) {
      console.warn('Failed to encode token, using original:', error);
      return JSON.stringify(token);
    }
  };

  const formattedToken = getFormattedToken();
  const isLongToken = formattedToken.length >= 500;

  const checkProofsSpent = async (token: Token): Promise<Result<boolean, Error>> => {
    try {
      const isSpendable = await isTokenSpendable(getEncodedTokenV4(token));
      return ok(!isSpendable); // Return true if NOT spendable (i.e., spent)
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Failed to check proof states'));
    }
  };

  const handleCheckStatus = async (onClose: (event: any) => void) => {
    if (isCheckingStatus) return;

    setIsCheckingStatus(true);
    const result = await checkProofsSpent(token);

    if (result.isOk()) {
      const proofsSpent = result.value;
      if (proofsSpent) {
        try {
          const amount = token.proofs.reduce((sum, proof) => sum + proof.amount, 0);

          showMessage('funds_sent', { amount, unit }, { emoji: '🎉' }, () => {
            router.dismissAll();
            router.push('/(drawer)/(tabs)');
            onClose({});
          });
        } catch {
          showMessage('Invalid token format', {}, { emoji: '⚠️' }, () => onClose({}));
        }
      } else {
        showMessage('ecash_transaction_pending', {}, { emoji: '❌' }, () => onClose({}));
      }
    } else {
      showMessage('error_checking_status', { error: result.error.message }, { emoji: '⚠️' }, () =>
        onClose({})
      );
    }
    setIsCheckingStatus(false);
  };

  const handleCopyEmoji = async (onClose: (event: any) => void) => {
    SheetManager.show('emoji-picker', {
      payload: {
        token: getEncodedTokenV4(token),
      },
      onClose,
    });
  };

  // Show loading state if transaction is not found
  if (!currentTransaction) {
    return <Modal showClose title="Loading..."></Modal>;
  }

  const isPaid = 'state' in currentTransaction && currentTransaction.state === 'PAID';

  return (
    <Modal
      title="Send Ecash"
      showClose
      buttons={
        <HStack justify="center" align="center">
          <ButtonHandler
            buttons={[
              {
                text: 'Close',
                icon: 'ri:close-circle-line',
                variant: 'secondary',
                onPress: async () => router.back(),
                condition: isPaid,
              },
              {
                text: 'View Messages',
                icon: 'mdi:message-reply',
                variant: 'primary',
                onPress: async () => {
                  router.push({
                    pathname: '/userMessages',
                    params: {
                      pubkey: currentTransaction.metadata?.nostr as string,
                    },
                  });
                  router.back();
                },
                condition: false, // Disabled until nostr property is available in Coco types
              },
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
                text: 'NFC',
                icon: 'ph:contactless-payment-fill',
                variant: 'secondary',
                onPress: handleNFCSend,
                condition: !isPaid,
              },
              {
                text: 'Send via Nostr',
                icon: 'mdi:send',
                variant: 'primary',
                loading: sendingNostr,
                onPress: handleSendNostr,
                condition: !!(resolvedPaymentRequest && !isPaid),
              },
              {
                text: 'Copy as Emoji',
                icon: 'fluent:emoji-24-filled',
                variant: 'primary',
                onPress: handleCopyEmoji,
                condition: !isPaid,
              },
              {
                text: 'Send Ecash',
                icon: 'mdi:send',
                variant: 'primary',
                loading: isSending,
                onPress: handleSendEcash,
                condition: !isPaid,
              },
              {
                text: 'Cancel Transaction',
                icon: 'mdi:cancel',
                variant: 'dangerous',
                onPress: handleCancelSend,
                condition: !isPaid,
              },
              ...extraButtons.map((button) => ({
                ...button,
                condition: !isPaid,
              })),
            ]}
          />
        </HStack>
      }>
      <TransactionHeader historyEntry={currentTransaction} />

      <VStack gap={12}>
        {!isPaid && (
          <PaymentInfo
            setUri={setUri}
            popupMessage="ecash_token_copied"
            unit={unit}
            data={formattedToken}
            animated={isLongToken}
            showSection={false}
          />
        )}

        {/* Memo display - Coco types don't have memo property directly accessible */}

        {mintInfo && (
          <TransactionMintRefresh
            historyEntry={currentTransaction}
            mintInfo={mintInfo}
            handleCheckStatus={handleCheckStatus}
          />
        )}

        <MintQuoteTimeline historyEntry={currentTransaction} />

        <Section
          items={[
            {
              title: 'Date',
              value: convertTime(new Date(currentTransaction.createdAt)),
            },
            {
              title: 'Type',
              value: 'Ecash • Send',
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
                    {isPaid ? 'Completed' : 'Pending'}
                  </Text>
                </HStack>
              ),
            },
            {
              title: 'Token',
              value: truncateMiddle(getEncodedTokenV4(token), 6),
            },
            {
              title: 'Amount',
              value: `${currentTransaction.amount} ${unit.toUpperCase()}`,
            },
          ]}
        />

        <TransactionDebugCode historyEntry={currentTransaction} />
      </VStack>
    </Modal>
  );
}

function ModalScreen() {
  const { unit, amount, token, paymentRequest } = useLocalSearchParams<{
    unit: string;
    amount: string;
    token: string;
    paymentRequest?: string;
  }>();

  // Convert string token to Token object if needed

  return (
    <EcashSendConfirmation
      unit={unit}
      amount={amount ? parseFloat(amount) : 0}
      token={JSON.parse(token)}
      paymentRequest={paymentRequest}
    />
  );
}

export default withSheetProvider(ModalScreen);
