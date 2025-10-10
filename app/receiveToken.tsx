/**
 * @fileoverview Ecash token receiving interface for the Sovran wallet
 *
 * This module provides the user interface for receiving ecash tokens from other users.
 * It handles token redemption, mint verification, and displays transaction details.
 *
 * @example
 * // Navigation usage
 * router.push({
 *   pathname: '/receiveToken',
 *   params: { receiveHistoryEntry: JSON.stringify(historyEntry) }
 * });
 *
 * // Component usage with a receive history entry
 * <ReceiveToken receiveHistoryEntry={historyEntry} />
 */

import React, { useState } from 'react';
import { useMintManagement, useReceive } from 'hooks/coco';
import Modal from 'components/blocks/Modal';
import { popup } from '@/helper/popup';
import { useLocalSearchParams, router } from 'expo-router';
import { SheetManager } from 'react-native-actions-sheet';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { Section } from 'components/ui/Section';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { TransactionHeader } from 'components/blocks/Transaction/TransactionHeader';
import { truncateMiddle } from 'helper/strings';
import { TransactionMintRefresh } from 'components/blocks/Transaction/TransactionMintRefresh';
import { TransactionDebugCode } from 'components/blocks/Transaction/TransactionDebugCode';
import { VStack } from 'components/ui/View';
import type { ReceiveHistoryEntry } from 'coco-cashu-core';

/**
 * Props for the ReceiveToken component
 */
interface ReceiveTokenProps {
  /** The receive history entry containing token and transaction details */
  receiveHistoryEntry: ReceiveHistoryEntry & { token?: string };
}

/**
 * Main component for receiving ecash tokens
 *
 * This component provides a complete interface for receiving ecash tokens, including:
 * - Token redemption with mint verification
 * - Transaction status display
 * - Mint information and refresh capabilities
 * - Debug information for troubleshooting
 *
 * The component automatically handles mint trust verification and shows appropriate
 * UI states based on the transaction status (pending vs completed).
 *
 * @param props - The component props
 * @returns JSX element representing the receive token interface
 *
 * @example
 * // Basic usage
 * <ReceiveToken receiveHistoryEntry={receiveEntry} />
 */
export function ReceiveToken({ receiveHistoryEntry }: ReceiveTokenProps) {
  const { receive } = useReceive();
  const { isKnownMint } = useMintManagement();

  const token = receiveHistoryEntry?.token;

  const [loading, setLoading] = useState(false);

  /**
   * Handles the cancel action by navigating back to the previous screen
   */
  const handleCancel = () => {
    router.back();
  };

  /**
   * Handles the actual token redemption process
   *
   * This function attempts to redeem the ecash token through the Coco receive hook.
   * On success, it shows a success popup with the received amount and navigates to
   * the main tabs. On failure, it displays an error popup with the error message.
   *
   * @private
   * @async
   * @throws {Error} When token redemption fails
   */
  const handleRedeem = async () => {
    setLoading(true);
    try {
      await receive(token as string);
      popup({
        message: 'funds_received',
        params: { amount: receiveHistoryEntry.amount, unit: receiveHistoryEntry.unit },
        emoji: '🎉',
        onClose: () => {
          router.dismissAll();
          router.push('/(drawer)/(tabs)');
        },
      });
    } catch (error) {
      console.error(error);
      popup({
        message: error instanceof Error ? error.message : 'Unknown error',
        type: 'error',
      });
    }
    setLoading(false);
  };

  /**
   * Handles the redeem button press with mint trust verification
   *
   * This function first checks if the mint is trusted. If trusted, it proceeds
   * directly with redemption. If not trusted, it shows the mint accepter sheet
   * to allow the user to trust the mint before proceeding with redemption.
   *
   * @async
   */
  const handleRedeemPress = async () => {
    const isMintTrusted = await isKnownMint(receiveHistoryEntry.mintUrl);
    if (isMintTrusted) {
      await handleRedeem();
    } else {
      SheetManager.show('mint-accepter', {
        payload: { mint: receiveHistoryEntry.mintUrl },
        onClose: async (result) => {
          if (result?.trusted) {
            await handleRedeem();
          }
        },
      });
    }
  };

  const { getMintInfo } = useMintManagement();
  const [mintInfo, setMintInfo] = React.useState<any>({});

  // Load mint info when mintUrl changes
  React.useEffect(() => {
    const loadMintInfo = async () => {
      if (receiveHistoryEntry.mintUrl) {
        try {
          const info = await getMintInfo(receiveHistoryEntry.mintUrl);
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
  }, [receiveHistoryEntry.mintUrl, getMintInfo]);

  return (
    <Modal
      title="Receive Ecash"
      childrenStyles={{}}
      showBack
      transparent={false}
      buttons={
        <ButtonHandler
          buttons={[
            {
              text: 'Cancel',
              variant: 'secondary',
              onPress: async () => handleCancel(),
              condition: !('state' in receiveHistoryEntry && receiveHistoryEntry.state === 'PAID'),
            },
            {
              text: 'Redeem Ecash',
              variant: 'primary',
              onPress: handleRedeemPress,
              loading: loading,
              condition: !!token,
            },
          ]}
        />
      }>
      <VStack gap={12}>
        <TransactionHeader historyEntry={receiveHistoryEntry} />

        <TransactionMintRefresh historyEntry={receiveHistoryEntry} mintInfo={mintInfo} />

        <Section
          items={[
            { title: 'Type', value: 'Ecash • Receive' },
            ...(token ? [{ title: 'Token', value: truncateMiddle(token, 6) }] : []),
          ]}
          camera={false}
        />

        <TransactionDebugCode historyEntry={receiveHistoryEntry} />
      </VStack>
    </Modal>
  );
}

/**
 * Modal screen wrapper for the ReceiveToken component
 *
 * This component handles the modal presentation of the receive token interface.
 * It parses the receive history entry from the URL parameters and passes it
 * to the main ReceiveToken component.
 *
 * @returns JSX element representing the modal screen
 */
function ModalScreen() {
  const { receiveHistoryEntry: receiveHistoryEntryString } = useLocalSearchParams<{
    receiveHistoryEntry: string;
  }>();

  const receiveHistoryEntry = JSON.parse(receiveHistoryEntryString) as ReceiveHistoryEntry & {
    token?: string;
  };

  return <ReceiveToken receiveHistoryEntry={receiveHistoryEntry} />;
}

/**
 * Default export wrapped with sheet provider for modal functionality
 *
 * This export provides the modal screen with the necessary sheet provider
 * context for displaying action sheets and other modal components.
 */
export default withSheetProvider(ModalScreen);
