/**
 * @fileoverview Shared SendToken screen component
 *
 * This module provides the core UI and logic for sending ecash tokens.
 * It is used by both standalone and flow-based route wrappers.
 *
 * The Screen component handles:
 * - Parsing sendHistoryEntry from string params
 * - Error states for missing/invalid data
 * - All UI and business logic
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Share, ScrollView } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SheetManager } from 'react-native-actions-sheet';
import { HStack, View, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { PaymentInfo } from 'components/blocks/PaymentInfo';
import { getEncodedTokenV4, GetInfoResponse } from '@cashu/cashu-ts';
import { useMintManagement } from 'hooks/coco';
import { usePaginatedHistory, useReceive } from 'coco-cashu-react';
import { popup } from '@/helper/popup';
import { writeTokenToNFC } from 'helper/nfc';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { Section } from 'components/ui/Section';
import { convertTime } from 'helper/time';
import { truncateMiddle } from 'helper/strings';
import { HistoryEntryRefresh } from 'components/blocks/Transaction/HistoryEntryRefresh';
import { TransactionDebugCode } from 'components/blocks/Transaction/TransactionDebugCode';
import { HistoryEntryTimeline } from 'components/blocks/Transaction/HistoryEntryTimeline';
import type { SendHistoryEntry } from 'coco-cashu-core';
import { HistoryEntryHeader } from '@/components/blocks/Transaction/HistoryEntryHeader';
import { BottomButtons } from 'components/ui/BottomButtons';
import { useTheme } from 'providers/ThemeProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface SendTokenScreenProps {
  /** Either the parsed entry or a JSON string to be parsed internally */
  sendHistoryEntry: SendHistoryEntry | string | undefined;
  onNavigateBack: () => void;
  onNavigateToMessages?: (pubkey: string) => void;
}

/** Error screen shown when transaction data is missing or invalid */
function ErrorState({ message, onNavigateBack }: { message: string; onNavigateBack: () => void }) {
  const { getPrimaryColor } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
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
    </View>
  );
}

export function SendTokenScreen({
  sendHistoryEntry: sendHistoryEntryProp,
  onNavigateBack,
  onNavigateToMessages,
}: SendTokenScreenProps) {
  const { receive } = useReceive();
  const { getMintInfo } = useMintManagement();
  const { getPrimaryColor } = useTheme();
  const insets = useSafeAreaInsets();
  const [_uri, setUri] = useState('');
  const [mintInfo, setMintInfo] = useState<GetInfoResponse | null>(null);

  // Parse sendHistoryEntry - handles both string (from params) and object
  const { sendHistoryEntry, parseError } = useMemo(() => {
    if (!sendHistoryEntryProp) {
      return { sendHistoryEntry: null, parseError: 'Missing transaction data. Please try again.' };
    }

    if (typeof sendHistoryEntryProp === 'string') {
      try {
        return {
          sendHistoryEntry: JSON.parse(sendHistoryEntryProp) as SendHistoryEntry,
          parseError: null,
        };
      } catch {
        return {
          sendHistoryEntry: null,
          parseError: 'Invalid transaction data. Please try again.',
        };
      }
    }

    return { sendHistoryEntry: sendHistoryEntryProp, parseError: null };
  }, [sendHistoryEntryProp]);

  const { history } = usePaginatedHistory();

  const currentTransaction = history.find((tx) => {
    return (
      tx.type === 'send' &&
      getEncodedTokenV4(tx.token) === getEncodedTokenV4(sendHistoryEntry?.token)
    );
  });

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
  if (parseError || !sendHistoryEntry) {
    return (
      <ErrorState
        message={parseError || 'Missing transaction data. Please try again.'}
        onNavigateBack={onNavigateBack}
      />
    );
  }

  const handleNFCSend = async (close: (event: any) => void): Promise<void> => {
    const success = await writeTokenToNFC(getEncodedTokenV4(sendHistoryEntry.token));
    if (success) {
      popup({ message: 'ecash_token_shared_via_nfc', type: 'success', onClose: () => close({}) });
    }
  };

  const handleCopy = async (onClose: (event: any) => void) => {
    await Clipboard.setStringAsync(getEncodedTokenV4(sendHistoryEntry.token));
    popup({ message: 'ecash_token_copied', type: 'success', onClose: () => onClose({}) });
  };

  const handleShare = async (onClose: (event: any) => void) => {
    await Share.share({
      message: 'cashu://' + getEncodedTokenV4(sendHistoryEntry.token),
    });
    onClose({});
  };

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

  const handleCopyEmoji = async (onClose: (event: any) => void) => {
    SheetManager.show('emoji-picker', {
      payload: {
        token: getEncodedTokenV4(sendHistoryEntry.token),
      },
      onClose,
    });
  };

  if (!currentTransaction) {
    return (
      <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
        <View style={{ flex: 1, padding: 20, alignItems: 'center', justifyContent: 'center' }}>
          <Text>Loading transaction...</Text>
        </View>
      </View>
    );
  }

  const isPaid = 'state' in currentTransaction && currentTransaction.state === 'PAID';

  return (
    <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + 48,
          paddingBottom: 120,
        }}>
        <VStack gap={12}>
          <HistoryEntryHeader historyEntry={currentTransaction} />

          {!isPaid && (
            <PaymentInfo
              setUri={setUri}
              popupMessage="ecash_token_copied"
              unit={sendHistoryEntry.unit}
              data={formattedToken}
              animated={isLongToken}
            />
          )}

          {mintInfo && (
            <HistoryEntryRefresh historyEntry={currentTransaction} mintInfo={mintInfo} />
          )}

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
      </ScrollView>

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
      </BottomButtons>
    </View>
  );
}
