/**
 * @fileoverview Ecash token sending interface for the Sovran wallet
 *
 * This module provides the user interface for sending ecash tokens to other users.
 * It handles token sharing, transaction cancellation, and displays comprehensive
 * transaction details with various sharing options including NFC, clipboard, and messaging.
 *
 * @example
 * // Navigation usage
 * router.push({
 *   pathname: '/sendToken',
 *   params: { sendHistoryEntry: JSON.stringify(sendEntry) }
 * });
 *
 * // Component usage with a send history entry
 * <SendToken sendHistoryEntry={sendEntry} />
 */

import React, { useState, useEffect } from 'react';
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Modal from 'components/blocks/Modal';
import { SheetManager } from 'react-native-actions-sheet';
import { HStack, View, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { PaymentInfo } from 'components/blocks/PaymentInfo';
import { getEncodedTokenV4, GetInfoResponse } from '@cashu/cashu-ts';
import { useMintManagement } from 'hooks/coco';
import { usePaginatedHistory, useReceive } from 'coco-cashu-react';
import { useLocalSearchParams, router } from 'expo-router';
import { popup } from '@/helper/popup';
import { write } from 'helper/nfc';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { Section } from 'components/ui/Section';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { TransactionHeader } from 'components/blocks/Transaction/TransactionHeader';
import { convertTime } from 'helper/time';
import { truncateMiddle } from 'helper/strings';
import { TransactionMintRefresh } from 'components/blocks/Transaction/TransactionMintRefresh';
import { TransactionDebugCode } from 'components/blocks/Transaction/TransactionDebugCode';
import { MintQuoteTimeline } from 'components/blocks/Transaction/TransactionTimeline';
import type { SendHistoryEntry } from 'coco-cashu-core';

/**
 * Props for the SendToken component
 */
interface SendTokenProps {
  /** The send history entry containing token and transaction details */
  sendHistoryEntry: SendHistoryEntry;
}

/**
 * Main component for sending ecash tokens
 *
 * This component provides a complete interface for sending ecash tokens, including:
 * - Token sharing via multiple methods (NFC, clipboard, share sheet, emoji)
 * - Transaction cancellation and redemption
 * - Real-time transaction status tracking
 * - Mint information and refresh capabilities
 * - Comprehensive transaction details display
 *
 * The component automatically finds the current transaction in the Coco history
 * and displays appropriate UI states based on the transaction status (pending vs completed).
 *
 * @param props - The component props
 * @returns JSX element representing the send token interface
 *
 * @example
 * // Basic usage
 * <SendToken sendHistoryEntry={sendEntry} />
 */
export function SendToken({ sendHistoryEntry }: SendTokenProps) {
  const { receive } = useReceive();
  const { getMintInfo } = useMintManagement();
  const [uri, setUri] = useState('');
  const [mintInfo, setMintInfo] = useState<GetInfoResponse | null>(null);

  const { history } = usePaginatedHistory();

  // Find the current transaction using coco's history system
  const currentTransaction = history.find((tx) => {
    return (
      tx.type === 'send' &&
      getEncodedTokenV4(tx.token) === getEncodedTokenV4(sendHistoryEntry.token)
    );
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

  /**
   * Handles NFC token sharing
   *
   * Writes the encoded ecash token to NFC for contactless sharing.
   * This allows users to share tokens by bringing their device close to another NFC-enabled device.
   *
   * @async
   * @throws {Error} When NFC writing fails
   */
  const handleNFCSend = async () => {
    await write(getEncodedTokenV4(sendHistoryEntry.token));
  };

  /**
   * Handles copying the token to clipboard
   *
   * Copies the encoded ecash token to the device clipboard and shows a success popup.
   * This allows users to paste the token in other applications or share it manually.
   *
   * @param onClose - Callback function to close any open modals
   * @async
   */
  const handleCopy = async (onClose: (event: any) => void) => {
    await Clipboard.setStringAsync(getEncodedTokenV4(sendHistoryEntry.token));
    popup({ message: 'ecash_token_copied', type: 'success', onClose: () => onClose({}) });
  };

  /**
   * Handles sharing the token via the native share sheet
   *
   * Opens the device's native share sheet with the ecash token and a cashu:// URL.
   * This allows users to share tokens through various apps like messaging, email, etc.
   *
   * @param onClose - Callback function to close any open modals
   * @async
   */
  const handleShare = async (onClose: (event: any) => void) => {
    await Share.share({
      url: uri,
      message: 'cashu://' + getEncodedTokenV4(sendHistoryEntry.token),
    });
    onClose({});
  };

  /**
   * Handles cancelling the send transaction
   *
   * Attempts to redeem the token back to the user's wallet, effectively cancelling
   * the send transaction. This is useful when the recipient hasn't claimed the token yet.
   *
   * @param onClose - Callback function to close any open modals
   * @async
   * @throws {Error} When token redemption fails
   */
  const handleCancelSend = async (onClose: (event: any) => void) => {
    try {
      await receive(getEncodedTokenV4(sendHistoryEntry.token));
      popup({ message: 'Transaction cancelled successfully', onClose: () => onClose({}) });
    } catch (error) {
      popup({
        message: error instanceof Error ? error.message : 'Failed to cancel transaction',
        onClose: () => onClose({}),
      });
    }
  };

  /**
   * Safely formats the token for display and sharing
   *
   * Attempts to encode the token using the Cashu V4 format. If encoding fails,
   * falls back to JSON stringification of the original token object.
   *
   * @returns The formatted token string
   * @private
   */
  const getFormattedToken = (): string => {
    try {
      return getEncodedTokenV4(sendHistoryEntry.token);
    } catch (error) {
      console.warn('Failed to encode token, using original:', error);
      return JSON.stringify(sendHistoryEntry.token);
    }
  };

  const formattedToken = getFormattedToken();
  const isLongToken = formattedToken.length >= 500;

  /**
   * Handles copying the token as emoji representation
   *
   * Opens the emoji picker sheet to allow users to share the token as emoji.
   * This provides an alternative sharing method that can be more user-friendly
   * for certain communication channels.
   *
   * @param onClose - Callback function to close any open modals
   * @async
   */
  const handleCopyEmoji = async (onClose: (event: any) => void) => {
    SheetManager.show('emoji-picker', {
      payload: {
        token: getEncodedTokenV4(sendHistoryEntry.token),
      },
      onClose,
    });
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
                text: 'Copy as Emoji',
                icon: 'fluent:emoji-24-filled',
                variant: 'primary',
                onPress: handleCopyEmoji,
                condition: !isPaid,
              },
              {
                text: 'Cancel Transaction',
                icon: 'mdi:cancel',
                variant: 'dangerous',
                onPress: handleCancelSend,
                condition: !isPaid,
              },
            ]}
          />
        </HStack>
      }>
      <VStack gap={12}>
        <TransactionHeader historyEntry={currentTransaction} />

        {!isPaid && (
          <PaymentInfo
            setUri={setUri}
            popupMessage="ecash_token_copied"
            unit={sendHistoryEntry.unit}
            data={formattedToken}
            animated={isLongToken}
          />
        )}

        {/* Memo display - Coco types don't have memo property directly accessible */}

        {mintInfo && (
          <TransactionMintRefresh historyEntry={currentTransaction} mintInfo={mintInfo} />
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
                    className="text-primary-0"
                    style={{
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
              value: truncateMiddle(getEncodedTokenV4(sendHistoryEntry.token), 6),
            },
            {
              title: 'Amount',
              value: `${currentTransaction.amount} ${sendHistoryEntry.unit.toUpperCase()}`,
            },
          ]}
        />

        <TransactionDebugCode historyEntry={currentTransaction} />
      </VStack>
    </Modal>
  );
}

/**
 * Modal screen wrapper for the SendToken component
 *
 * This component handles the modal presentation of the send token interface.
 * It parses the send history entry from the URL parameters and passes it
 * to the main SendToken component.
 *
 * @returns JSX element representing the modal screen
 */
function ModalScreen() {
  const { sendHistoryEntry: sendHistoryEntryString } = useLocalSearchParams<{
    sendHistoryEntry: string;
  }>();

  const sendHistoryEntry = JSON.parse(sendHistoryEntryString) as SendHistoryEntry;

  return <SendToken sendHistoryEntry={sendHistoryEntry} />;
}

/**
 * Default export wrapped with sheet provider for modal functionality
 *
 * This export provides the modal screen with the necessary sheet provider
 * context for displaying action sheets and other modal components.
 */
export default withSheetProvider(ModalScreen);
