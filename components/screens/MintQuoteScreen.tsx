/**
 * @fileoverview Shared MintQuote screen component
 *
 * This module provides the core UI and logic for Lightning mint quotes (receiving).
 * It is used by both standalone and flow-based route wrappers.
 */

import React, { useEffect, useState } from 'react';
import { Share } from 'react-native';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Text } from 'components/ui/Text';
import * as Clipboard from 'expo-clipboard';
import { PaymentInfo } from 'components/blocks/PaymentInfo';
import { popup } from '@/helper/popup';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { useManager } from 'coco-cashu-react';
import { Section } from 'components/ui/Section';
import { truncateMiddle } from 'helper/strings';
import { Card } from 'components/ui/Card';
import type { ButtonHandlerButton } from 'components/ui/ButtonHandler';
import { HistoryEntryRefresh } from 'components/blocks/Transaction/HistoryEntryRefresh';
import { TransactionDebugCode } from 'components/blocks/Transaction/TransactionDebugCode';
import { HistoryEntryTimeline } from 'components/blocks/Transaction/HistoryEntryTimeline';
import type { MintHistoryEntry } from 'coco-cashu-core';
import { HistoryEntryHeader } from '@/components/blocks/Transaction/HistoryEntryHeader';
import { BottomButtons } from 'components/ui/BottomButtons';
import { ModalLayoutWrapper } from 'app/debugModal';
import { useHistoryEntry } from '@/hooks/coco/useHistoryEntry';

interface MintQuoteScreenProps {
  /** Either the parsed entry or a JSON string to be parsed internally */
  mintHistoryEntry: MintHistoryEntry | string;
  extraButtons?: ButtonHandlerButton[];
}

export function MintQuoteScreen({
  mintHistoryEntry: mintHistoryEntryProp,
  extraButtons = [],
}: MintQuoteScreenProps) {
  const manager = useManager();
  const [uri, setUri] = useState<string | null>(null);
  const [mintInfo, setMintInfo] = useState<any>(null);

  // Use the generic history entry hook for parsing, state, and event subscription
  const { entry: currentTransaction, error: parseError } =
    useHistoryEntry<MintHistoryEntry>(mintHistoryEntryProp);

  useEffect(() => {
    if (currentTransaction?.mintUrl) {
      manager.mint
        .getMintInfo(currentTransaction.mintUrl)
        .then(setMintInfo)
        .catch(() => setMintInfo(null));
    }
  }, [currentTransaction?.mintUrl, manager]);

  // Show loading/error state if entry not available
  if (parseError || !currentTransaction) {
    return (
      <ModalLayoutWrapper>
        <View style={{ flex: 1, padding: 20, alignItems: 'center', justifyContent: 'center' }}>
          <Text>{parseError || 'Loading transaction...'}</Text>
        </View>
      </ModalLayoutWrapper>
    );
  }

  const handleCopy = async (close: (event: any) => void) => {
    await Clipboard.setStringAsync(currentTransaction.paymentRequest);
    popup({ message: 'lightning_address_copied', type: 'success', onClose: () => close({}) });
  };

  const handleShare = async (close: (event: any) => void) => {
    if (uri) {
      await Share.share({ url: uri, message: currentTransaction.paymentRequest });
    }
    close({});
  };

  const isPaid =
    (currentTransaction as any)?.state === 'ISSUED' ||
    (currentTransaction as any)?.state === 'PAID';

  const bottomButtons = (
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
  );

  return (
    <ModalLayoutWrapper contentPadding={0} bottomContent={bottomButtons}>
      <VStack gap={12}>
        <HistoryEntryHeader historyEntry={currentTransaction} />
        {!isPaid && (
          <PaymentInfo
            setUri={setUri}
            data={[{ name: 'Lightning', value: currentTransaction.paymentRequest }]}
            unit={currentTransaction.unit}
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
              value: truncateMiddle(currentTransaction.paymentRequest, 10),
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
              value: `${currentTransaction.amount} ${currentTransaction.unit.toUpperCase()}`,
            },
          ]}
        />

        <TransactionDebugCode historyEntry={currentTransaction} />
      </VStack>
    </ModalLayoutWrapper>
  );
}

export function getFormattedMintQuoteTitle(unit: string): string {
  const isBitcoin = unit === 'sat';
  return `Receive ${isBitcoin ? 'Bitcoin' : unit.toUpperCase()}`;
}
