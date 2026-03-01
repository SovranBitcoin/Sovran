/**
 * @fileoverview Shared MintQuote screen component
 *
 * This module provides the core UI and logic for Lightning mint quotes (receiving).
 * It is used by both standalone and flow-based route wrappers.
 */

import React, { useState } from 'react';
import { Share } from 'react-native';

import * as Clipboard from 'expo-clipboard';

import type { MintHistoryEntry } from 'coco-cashu-core';

import { popup } from '@/helper/popup';
import { truncateMiddle } from 'helper/strings';
import { HistoryEntryHeader } from '@/components/blocks/Transaction/HistoryEntryHeader';
import { HistoryEntryRefresh } from 'components/blocks/Transaction/HistoryEntryRefresh';
import { HistoryEntryTimeline } from 'components/blocks/Transaction/HistoryEntryTimeline';
import { TransactionLocationSection } from 'components/blocks/TransactionLocationSection';
import { PaymentInfo } from 'components/blocks/PaymentInfo';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import type { ButtonHandlerButton } from 'components/ui/ButtonHandler';
import { BottomButtons } from 'components/ui/BottomButtons';
import { Card } from 'components/ui/Card';
import { DetailsSection } from 'components/ui/DetailsSection';
import { ModalLayoutWrapper } from 'app/debugModal';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { ScreenErrorState, ScreenLoadingState } from 'components/ui/ScreenStates';
import { useHistoryEntry } from '@/hooks/coco/useHistoryEntry';
import { useTransactionSource } from '@/components/blocks/Transaction/TransactionSourceSection';
import { useMintInfo } from 'hooks/useMintInfo';

interface MintQuoteScreenProps {
  /** Either the parsed entry or a JSON string to be parsed internally */
  mintHistoryEntry: MintHistoryEntry | string;
  extraButtons?: ButtonHandlerButton[];
}

export function MintQuoteScreen({
  mintHistoryEntry: mintHistoryEntryProp,
  extraButtons = [],
}: MintQuoteScreenProps) {
  const [, setUri] = useState<string | null>(null);

  const { entry: currentTransaction, error: parseError } =
    useHistoryEntry<MintHistoryEntry>(mintHistoryEntryProp);
  const sourceLabel = useTransactionSource(currentTransaction?.id);
  const mintInfo = useMintInfo(currentTransaction?.mintUrl);

  if (parseError) {
    return <ScreenErrorState message={parseError} onGoBack={() => {}} />;
  }

  if (!currentTransaction) {
    return <ScreenLoadingState message="Loading transaction..." />;
  }

  const handleCopy = async (close: (event: any) => void) => {
    await Clipboard.setStringAsync(currentTransaction.paymentRequest);
    popup({ message: 'lightning_address_copied', type: 'success', onClose: () => close({}) });
  };

  const handleShare = async (close: (event: any) => void) => {
    await Share.share({ message: currentTransaction.paymentRequest });
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

        {isPaid && <TransactionLocationSection transactionId={currentTransaction.id} />}

        {currentTransaction.metadata?.memo && (
          <Card message={currentTransaction.metadata.memo} variant="info" />
        )}

        {mintInfo && <HistoryEntryRefresh mintInfo={mintInfo} historyEntry={currentTransaction} />}

        <HistoryEntryTimeline historyEntry={currentTransaction} />

        <DetailsSection
          items={[
            ...(sourceLabel ? [{ title: 'Source', value: sourceLabel }] : []),
            {
              title: 'Invoice',
              value: truncateMiddle(currentTransaction.paymentRequest, 10),
            },
          ]}
        />
      </VStack>
    </ModalLayoutWrapper>
  );
}

export function getFormattedMintQuoteTitle(unit: string): string {
  const isBitcoin = unit === 'sat';
  return `Receive ${isBitcoin ? 'Bitcoin' : unit.toUpperCase()}`;
}
