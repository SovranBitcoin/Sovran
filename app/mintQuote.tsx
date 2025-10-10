/**
 * @fileoverview Lightning payment mint quote interface for the Sovran wallet
 *
 * This module provides the user interface for receiving Lightning payments by creating
 * mint quotes. It handles Lightning invoice display, payment status tracking, and
 * displays comprehensive transaction details with mint management capabilities.
 *
 * @example
 * // Navigation usage
 * router.push({
 *   pathname: '/mintQuote',
 *   params: { mintHistoryEntry: JSON.stringify(historyEntry) }
 * });
 *
 * // Component usage with a mint history entry
 * <MintQuote mintHistoryEntry={historyEntry} />
 *
 * // With additional custom buttons
 * <MintQuote
 *   mintHistoryEntry={historyEntry}
 *   extraButtons={[{ text: 'Custom Action', onPress: handleCustom }]}
 * />
 */

import React, { useEffect, useState } from 'react';
import { Share } from 'react-native';
import { View, HStack, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import * as Clipboard from 'expo-clipboard';
import Modal from 'components/blocks/Modal';
import { PaymentInfo } from 'components/blocks/PaymentInfo';
import { popup } from '@/helper/popup';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { useManager, usePaginatedHistory } from 'coco-cashu-react';
import { Section } from 'components/ui/Section';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { TransactionHeader } from 'components/blocks/Transaction/TransactionHeader';
import { truncateMiddle } from 'helper/strings';
import { Card } from 'components/ui/Card';
import { useLocalSearchParams } from 'expo-router';
import type { ButtonHandlerButton } from 'components/ui/ButtonHandler';
import { TransactionMintRefresh } from 'components/blocks/Transaction/TransactionMintRefresh';
import { TransactionDebugCode } from 'components/blocks/Transaction/TransactionDebugCode';
import { TransactionTimeline } from 'components/blocks/Transaction/TransactionTimeline';
import type { MintHistoryEntry, HistoryEntry } from 'coco-cashu-core';

/**
 * Props for the MintQuote component
 */
interface MintQuoteProps {
  /** The mint history entry containing Lightning invoice and transaction details */
  mintHistoryEntry: MintHistoryEntry;
  /** Whether to automatically go back when payment is completed (deprecated) */
  autoGoBackOnPaid?: boolean;
  /** Additional custom buttons to display in the action bar */
  extraButtons?: ButtonHandlerButton[];
}

/**
 * Main component for receiving Lightning payments via mint quotes
 *
 * This component provides a complete interface for receiving Lightning payments, including:
 * - Lightning invoice display and sharing
 * - Payment status tracking and updates
 * - Mint information and refresh capabilities
 * - Transaction timeline and debug information
 * - Support for custom action buttons
 *
 * The component automatically finds the current transaction in the Coco history
 * and displays appropriate UI states based on the payment status (pending vs completed).
 *
 * @param props - The component props
 * @returns JSX element representing the mint quote interface
 *
 * @example
 * // Basic usage
 * <MintQuote mintHistoryEntry={historyEntry} />
 *
 * // With custom buttons
 * <MintQuote
 *   mintHistoryEntry={historyEntry}
 *   extraButtons={[
 *     { text: 'View Details', onPress: () => console.log('Details') }
 *   ]}
 * />
 */
export function MintQuote({ mintHistoryEntry, extraButtons = [] }: MintQuoteProps) {
  const manager = useManager();
  const [uri, setUri] = useState<string | null>(null);
  const [mintInfo, setMintInfo] = useState<any>(null);

  const { history } = usePaginatedHistory();

  // Find the current transaction using Coco's history system
  const currentTransaction = history.find(
    (historyEntry: HistoryEntry) =>
      historyEntry.type === 'mint' &&
      historyEntry.paymentRequest === mintHistoryEntry.paymentRequest
  );

  // Load mint info when transaction is found
  useEffect(() => {
    if (currentTransaction?.mintUrl) {
      manager.mint
        .getMintInfo(currentTransaction.mintUrl)
        .then(setMintInfo)
        .catch(() => setMintInfo(null));
    }
  }, [currentTransaction?.mintUrl, manager]);

  /**
   * Handles copying the Lightning invoice to clipboard
   *
   * Copies the Lightning payment request to the device clipboard and shows a success popup.
   * This allows users to paste the invoice in other applications or share it manually.
   *
   * @param close - Callback function to close any open modals
   * @async
   */
  const handleCopy = async (close: (event: any) => void) => {
    await Clipboard.setStringAsync(mintHistoryEntry.paymentRequest);
    popup({ message: 'lightning_address_copied', type: 'success', onClose: () => close({}) });
  };

  /**
   * Handles sharing the Lightning invoice via the native share sheet
   *
   * Opens the device's native share sheet with the Lightning payment request.
   * This allows users to share the invoice through various apps like messaging, email, etc.
   *
   * @param close - Callback function to close any open modals
   * @async
   */
  const handleShare = async (close: (event: any) => void) => {
    if (uri) {
      await Share.share({ url: uri, message: mintHistoryEntry.paymentRequest });
    }
    close({});
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

  const isBitcoin = mintHistoryEntry.unit === 'sat';
  const isPaid =
    (currentTransaction as any)?.state === 'ISSUED' ||
    (currentTransaction as any)?.state === 'PAID';

  return (
    <Modal
      showClose
      title={`Receive ${isBitcoin ? 'Bitcoin' : mintHistoryEntry.unit.toUpperCase()}`}
      buttons={
        <HStack justify="center" align="center">
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
              ...extraButtons.map((button) => ({ ...button, condition: !isPaid })),
            ]}
          />
        </HStack>
      }>
      <VStack gap={12}>
        <TransactionHeader historyEntry={currentTransaction} />
        {!isPaid && (
          <PaymentInfo
            setUri={setUri}
            data={[{ name: 'Lightning', value: mintHistoryEntry.paymentRequest }]}
            unit={mintHistoryEntry.unit}
            popupMessage={[{ name: 'lightning_address_copied' }]}
          />
        )}

        {currentTransaction.metadata?.memo && (
          <>
            <Card message={currentTransaction.metadata.memo} variant="info" />
          </>
        )}

        <TransactionMintRefresh
          mintInfo={mintInfo}
          historyEntry={currentTransaction}
          handleCheckStatus={async () => {}}
        />

        <TransactionTimeline historyEntry={currentTransaction} />

        <Section
          special={false}
          items={[
            {
              title: 'Request',
              value: truncateMiddle(mintHistoryEntry.paymentRequest, 10),
            },
            {
              title: 'Type',
              value: 'Lightning • Receive',
            },
            {
              title: 'Status',
              value: (
                <HStack align="center">
                  <Text
                    className="text-primary-0"
                    style={{ fontSize: 16, fontFamily: 'OverpassBold' }}>
                    {isPaid ? 'Completed' : 'Pending'}
                  </Text>
                </HStack>
              ),
            },
            {
              title: 'Amount',
              value: `${currentTransaction.amount} ${mintHistoryEntry.unit.toUpperCase()}`,
            },
          ]}
        />

        <TransactionDebugCode historyEntry={currentTransaction} />
      </VStack>
    </Modal>
  );
}

/**
 * Modal screen wrapper for the MintQuote component
 *
 * This component handles the modal presentation of the mint quote interface.
 * It parses the mint history entry from the URL parameters and passes it
 * to the main MintQuote component.
 *
 * @returns JSX element representing the modal screen
 */
function ModalScreen() {
  const { mintHistoryEntry: mintHistoryEntryString } = useLocalSearchParams<{
    mintHistoryEntry: string;
  }>();

  const mintHistoryEntry = JSON.parse(mintHistoryEntryString) as MintHistoryEntry;

  return <MintQuote mintHistoryEntry={mintHistoryEntry} />;
}

/**
 * Default export wrapped with sheet provider for modal functionality
 *
 * This export provides the modal screen with the necessary sheet provider
 * context for displaying action sheets and other modal components.
 */
export default withSheetProvider(ModalScreen);
