/**
 * @fileoverview Shared MintQuote screen component
 *
 * This module provides the core UI and logic for Lightning mint quotes (receiving).
 * It is used by both standalone and flow-based route wrappers.
 */

import React, { useEffect, useState } from 'react';
import { Share, ScrollView } from 'react-native';
import { View, HStack, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import * as Clipboard from 'expo-clipboard';
import { PaymentInfo } from 'components/blocks/PaymentInfo';
import { popup } from '@/helper/popup';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { useManager, usePaginatedHistory } from 'coco-cashu-react';
import { Section } from 'components/ui/Section';
import { truncateMiddle } from 'helper/strings';
import { Card } from 'components/ui/Card';
import type { ButtonHandlerButton } from 'components/ui/ButtonHandler';
import { HistoryEntryRefresh } from 'components/blocks/Transaction/HistoryEntryRefresh';
import { TransactionDebugCode } from 'components/blocks/Transaction/TransactionDebugCode';
import { HistoryEntryTimeline } from 'components/blocks/Transaction/HistoryEntryTimeline';
import type { MintHistoryEntry, HistoryEntry } from 'coco-cashu-core';
import { HistoryEntryHeader } from '@/components/blocks/Transaction/HistoryEntryHeader';
import { BottomButtons } from 'components/ui/BottomButtons';
import { useTheme } from 'providers/ThemeProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface MintQuoteScreenProps {
  mintHistoryEntry: MintHistoryEntry;
  extraButtons?: ButtonHandlerButton[];
}

export function MintQuoteScreen({ mintHistoryEntry, extraButtons = [] }: MintQuoteScreenProps) {
  const manager = useManager();
  const { getPrimaryColor } = useTheme();
  const insets = useSafeAreaInsets();
  const [uri, setUri] = useState<string | null>(null);
  const [mintInfo, setMintInfo] = useState<any>(null);

  const { history } = usePaginatedHistory();

  const currentTransaction = history.find(
    (historyEntry: HistoryEntry) =>
      historyEntry.type === 'mint' &&
      historyEntry.paymentRequest === mintHistoryEntry.paymentRequest
  );

  useEffect(() => {
    if (currentTransaction?.mintUrl) {
      manager.mint
        .getMintInfo(currentTransaction.mintUrl)
        .then(setMintInfo)
        .catch(() => setMintInfo(null));
    }
  }, [currentTransaction?.mintUrl, manager]);

  const handleCopy = async (close: (event: any) => void) => {
    await Clipboard.setStringAsync(mintHistoryEntry.paymentRequest);
    popup({ message: 'lightning_address_copied', type: 'success', onClose: () => close({}) });
  };

  const handleShare = async (close: (event: any) => void) => {
    if (uri) {
      await Share.share({ url: uri, message: mintHistoryEntry.paymentRequest });
    }
    close({});
  };

  const isBitcoin = mintHistoryEntry.unit === 'sat';
  const _formattedTitle = `Receive ${isBitcoin ? 'Bitcoin' : mintHistoryEntry.unit.toUpperCase()}`;

  if (!currentTransaction) {
    return (
      <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
        <View style={{ flex: 1, padding: 20, alignItems: 'center', justifyContent: 'center' }}>
          <Text>Loading transaction...</Text>
        </View>
      </View>
    );
  }

  const isPaid =
    (currentTransaction as any)?.state === 'ISSUED' ||
    (currentTransaction as any)?.state === 'PAID';

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
              data={[{ name: 'Lightning', value: mintHistoryEntry.paymentRequest }]}
              unit={mintHistoryEntry.unit}
              popupMessage={[{ name: 'lightning_address_copied' }]}
            />
          )}

          {currentTransaction.metadata?.memo && (
            <Card message={currentTransaction.metadata.memo} variant="info" />
          )}

          <HistoryEntryRefresh
            mintInfo={mintInfo}
            historyEntry={currentTransaction}
            handleCheckStatus={async () => {}}
          />

          <HistoryEntryTimeline historyEntry={currentTransaction} />

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
                    <Text className="text-primary-0" size={16} overpass bold>
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
      </ScrollView>

      <BottomButtons>
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
      </BottomButtons>
    </View>
  );
}

export function getFormattedMintQuoteTitle(unit: string): string {
  const isBitcoin = unit === 'sat';
  return `Receive ${isBitcoin ? 'Bitcoin' : unit.toUpperCase()}`;
}

