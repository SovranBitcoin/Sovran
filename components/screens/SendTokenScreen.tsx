/**
 * @fileoverview Shared SendToken screen component
 *
 * This module provides the core UI and logic for sending ecash tokens.
 * It is used by both standalone and flow-based route wrappers.
 */

import React, { useState, useEffect } from 'react';
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SheetManager } from 'react-native-actions-sheet';
import { HStack } from 'components/ui/View/HStack';
import { VStack } from 'components/ui/View/VStack';
import { View } from 'components/ui/View/View';
import { Text } from 'components/ui/Text';
import { PaymentInfo } from 'components/blocks/PaymentInfo';
import { getEncodedTokenV4, GetInfoResponse } from '@cashu/cashu-ts';
import { useReceive, useManager } from 'coco-cashu-react';
import type { SendHistoryEntry } from 'coco-cashu-core';
import { popup } from '@/helper/popup';
import { writeTokenToNFC } from 'helper/nfc';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { Section } from 'components/ui/Section';
import { convertTime } from 'helper/time';
import { truncateMiddle } from 'helper/strings';
import { HistoryEntryRefresh } from 'components/blocks/Transaction/HistoryEntryRefresh';
import { TransactionDebugCode } from 'components/blocks/Transaction/TransactionDebugCode';
import { HistoryEntryTimeline } from 'components/blocks/Transaction/HistoryEntryTimeline';
import { HistoryEntryHeader } from '@/components/blocks/Transaction/HistoryEntryHeader';
import { BottomButtons } from 'components/ui/BottomButtons';
import { ModalLayoutWrapper } from 'app/debugModal';
import { useHistoryEntry } from '@/hooks/coco/useHistoryEntry';
import { useMintManagement } from '@/hooks/coco/useMintManagement';
import { TransactionLocationSection } from 'components/blocks/TransactionLocationSection';

interface SendTokenScreenProps {
  /** Either the parsed entry or a JSON string to be parsed internally */
  sendHistoryEntry: SendHistoryEntry | string | undefined;
  onNavigateBack: () => void;
  onNavigateToMessages?: (pubkey: string) => void;
}

/** Error screen shown when transaction data is missing or invalid */
function ErrorState({ message, onNavigateBack }: { message: string; onNavigateBack: () => void }) {
  return (
    <ModalLayoutWrapper>
      <View style={{ flex: 1, padding: 20, alignItems: 'center', justifyContent: 'center' }}>
        <Text>{message}</Text>
        <ButtonHandler
          buttons={[
            {
              text: 'Go Back',
              icon: 'ri:arrow-left-line',
              variant: 'primary',
              onPress: async () => onNavigateBack(),
            },
          ]}
        />
      </View>
    </ModalLayoutWrapper>
  );
}

export function SendTokenScreen({
  sendHistoryEntry: sendHistoryEntryProp,
  onNavigateBack,
  onNavigateToMessages,
}: SendTokenScreenProps) {
  const { receive: _receive } = useReceive();
  const { getMintInfo } = useMintManagement();
  const manager = useManager();
  const [, setUri] = useState('');
  const [mintInfo, setMintInfo] = useState<GetInfoResponse | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);

  // Use the generic history entry hook for parsing, state, and event subscription
  const { entry: currentTransaction, error: parseError } =
    useHistoryEntry<SendHistoryEntry>(sendHistoryEntryProp);

  // Load mint info when entry changes
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

  // Show error state if parsing failed
  if (parseError || !currentTransaction) {
    return (
      <ErrorState
        message={parseError || 'Missing transaction data. Please try again.'}
        onNavigateBack={onNavigateBack}
      />
    );
  }

  // Token is only available after execute (state >= pending)
  const token = currentTransaction.token;

  const handleNFCSend = async (close: (event: any) => void): Promise<void> => {
    if (!token) return;
    const success = await writeTokenToNFC(getEncodedTokenV4(token));
    if (success) {
      popup({ message: 'ecash_token_shared_via_nfc', type: 'success', onClose: () => close({}) });
    }
  };

  const handleCopy = async (onClose: (event: any) => void) => {
    if (!token) return;
    await Clipboard.setStringAsync(getEncodedTokenV4(token));
    popup({ message: 'ecash_token_copied', type: 'success', onClose: () => onClose({}) });
  };

  const handleShare = async (onClose: (event: any) => void) => {
    if (!token) return;
    await Share.share({
      message: 'cashu://' + getEncodedTokenV4(token),
    });
    onClose({});
  };

  const handleCancelSend = async (onClose: (event: any) => void) => {
    if (!token) return;
    try {
      // await receive(getEncodedTokenV4(token));
      await manager.send.rollback(currentTransaction.operationId);
      popup({ message: 'Transaction cancelled successfully', onClose: () => onClose({}) });
    } catch (error) {
      popup({
        message: error instanceof Error ? error.message : 'Failed to cancel transaction',
        onClose: () => onClose({}),
      });
    }
  };

  const handleCheckStatus = async (onClose: (event: any) => void) => {
    if (!currentTransaction?.operationId) return;
    setIsCheckingStatus(true);
    try {
      // Get the operation from the send operation service
      const operation = await manager.send.getOperation(currentTransaction.operationId);
      if (!operation) {
        popup({ message: 'Operation not found', onClose: () => onClose({}) });
        return;
      }

      if (operation.state === 'finalized') {
        popup({
          message: 'Token was already redeemed by recipient',
          type: 'success',
          onClose: () => onClose({}),
        });
        return;
      }

      if (operation.state === 'rolled_back') {
        popup({
          message: 'Transaction was already cancelled',
          type: 'info',
          onClose: () => onClose({}),
        });
        return;
      }

      if (operation.state !== 'pending') {
        popup({
          message: `Cannot check status for operation in state: ${operation.state}`,
          onClose: () => onClose({}),
        });
        return;
      }

      // Check the operation status with the mint (this will finalize if proofs are spent)
      await manager.send.checkPendingOperation(currentTransaction.operationId);

      // Re-fetch to see if state changed
      const updatedOperation = await manager.send.getOperation(currentTransaction.operationId);
      if (updatedOperation?.state === 'finalized') {
        popup({
          message: 'Token was redeemed by recipient',
          type: 'success',
          onClose: () => onClose({}),
        });
      } else {
        popup({
          message: 'Token is still pending - not yet redeemed',
          type: 'info',
          onClose: () => onClose({}),
        });
      }
    } catch (error) {
      popup({
        message: error instanceof Error ? error.message : 'Failed to check status',
        onClose: () => onClose({}),
      });
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const getFormattedToken = (): string => {
    if (!token) return '';
    try {
      return getEncodedTokenV4(token);
    } catch (error) {
      console.warn('Failed to encode token, using original:', error);
      return JSON.stringify(token);
    }
  };

  const formattedToken = getFormattedToken();
  const isLongToken = formattedToken.length >= 500;

  const handleCopyEmoji = async (onClose: (event: any) => void) => {
    SheetManager.show('emoji-picker', {
      payload: {
        token: currentTransaction.token ? getEncodedTokenV4(currentTransaction.token) : '',
      },
      onClose,
    });
  };

  // SendHistoryEntry has a state field: 'prepared' | 'pending' | 'finalized' | 'rolledBack'
  // The transaction is "paid/completed" when state is 'finalized'
  const isPaid =
    currentTransaction.state === 'finalized' || currentTransaction.state === 'rolledBack';

  const bottomButtons = (
    <BottomButtons>
      <HStack justify="center" align="center">
        <ButtonHandler
          buttons={[
            {
              text: 'Close',
              icon: 'ri:close-circle-line',
              variant: 'secondary',
              onPress: async () => onNavigateBack(),
              condition: isPaid,
            },
            {
              text: 'View Messages',
              icon: 'mdi:message-reply',
              variant: 'primary',
              onPress: async () => {
                if (onNavigateToMessages && currentTransaction.metadata?.nostr) {
                  onNavigateToMessages(currentTransaction.metadata.nostr as string);
                }
                onNavigateBack();
              },
              condition: false,
            },
            {
              text: 'Copy',
              icon: 'lets-icons:copy',
              variant: 'primary',
              onPress: handleCopy,
              condition: !isPaid && !!token,
            },
            {
              text: 'Share',
              icon: 'ri:share-fill',
              variant: 'secondary',
              onPress: handleShare,
              condition: !isPaid && !!token,
            },
            {
              text: 'NFC',
              icon: 'ph:contactless-payment-fill',
              variant: 'secondary',
              onPress: handleNFCSend,
              condition: !isPaid && !!token,
            },
            {
              text: 'Copy as Emoji',
              icon: 'fluent:emoji-24-filled',
              variant: 'primary',
              onPress: handleCopyEmoji,
              condition: !isPaid && !!token,
            },
            {
              text: isCheckingStatus ? 'Checking...' : 'Check Status',
              icon: 'mdi:refresh',
              variant: 'secondary',
              onPress: handleCheckStatus,
              condition: !isPaid && !!token && currentTransaction?.state === 'pending',
            },
            {
              text: 'Cancel Transaction',
              icon: 'mdi:cancel',
              variant: 'dangerous',
              onPress: handleCancelSend,
              condition: !isPaid && !!token,
            },
          ]}
        />
      </HStack>
    </BottomButtons>
  );

  return (
    <ModalLayoutWrapper contentPadding={0} bottomContent={bottomButtons}>
      <VStack gap={12}>
        <HistoryEntryHeader historyEntry={currentTransaction} />

        {!isPaid && token && (
          <PaymentInfo
            setUri={setUri}
            popupMessage="ecash_token_copied"
            unit={currentTransaction.unit}
            data={formattedToken}
            animated={isLongToken}
          />
        )}

        <TransactionLocationSection transactionId={currentTransaction.id} />

        {mintInfo && <HistoryEntryRefresh historyEntry={currentTransaction} mintInfo={mintInfo} />}

        <HistoryEntryTimeline historyEntry={currentTransaction} />

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
                  <Text className="text-primary-0" size={16} overpass bold>
                    {currentTransaction.state === 'finalized'
                      ? 'Completed'
                      : currentTransaction.state === 'rolledBack'
                        ? 'Rolled Back'
                        : 'Pending'}
                  </Text>
                </HStack>
              ),
            },
            {
              title: 'Token',
              value: token ? truncateMiddle(getEncodedTokenV4(token), 6) : 'N/A',
            },
            {
              title: 'Amount',
              value: `${currentTransaction.amount} ${currentTransaction.unit.toUpperCase()}`,
            },
          ]}
        />

        <TransactionDebugCode historyEntry={currentTransaction} />
      </VStack>
    </ModalLayoutWrapper>
  );
}
