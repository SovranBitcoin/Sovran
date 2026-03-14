/**
 * @fileoverview Shared MintQuote screen component
 *
 * Pure display component for Lightning mint quotes (receiving).
 * The mint quote is created before navigation — this screen only renders
 * and subscribes to live updates on the provided MintHistoryEntry.
 */

import React from 'react';
import { Share } from 'react-native';

import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';

import type { MintHistoryEntry } from 'coco-cashu-core';

import { MintSelector } from '@/features/wallet';
import { copyPopup } from '@/shared/lib/popup';
import { truncateMiddle } from '@/shared/lib/strings';
import {
  HistoryEntryHeader,
  HistoryEntryRefresh,
  HistoryEntryTimeline,
  TransactionLocationSection,
  useHistoryEntry,
  useTransactionSource,
} from '@/features/transactions';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import type { ButtonHandlerButton } from '@/shared/ui/composed/ButtonHandler';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { Card } from '@/shared/ui/composed/Card';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { ModalLayoutWrapper } from '@/shared/ui/composed/ModalLayoutWrapper';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import { useMintInfo } from '@/shared/hooks/useMintInfo';

interface MintQuoteScreenProps {
  /** Either the parsed entry or a JSON string to be parsed internally */
  mintHistoryEntry: MintHistoryEntry | string;
  extraButtons?: ButtonHandlerButton[];
  /** Mint URL to display in MintSelector. Reflects any mid-flow changeMint(). */
  selectedMintUrl?: string;
  /** Called when user picks a mint from the MintSelector. */
  onMintSelected?: (mintUrl: string) => void;
  /** Called when user requests to see the full mint list. */
  onRequestMintList?: () => void;
}

export function MintQuoteScreen({
  mintHistoryEntry: mintHistoryEntryProp,
  extraButtons = [],
  selectedMintUrl,
  onMintSelected,
  onRequestMintList,
}: MintQuoteScreenProps) {
  const { entry: currentTransaction, error: parseError } =
    useHistoryEntry<MintHistoryEntry>(mintHistoryEntryProp);
  const sourceLabel = useTransactionSource(currentTransaction?.id);
  const mintInfo = useMintInfo(currentTransaction?.mintUrl);

  if (parseError) {
    return <ScreenErrorState message={parseError} onGoBack={() => router.back()} />;
  }

  if (!currentTransaction) {
    return <ScreenLoadingState message="Loading transaction..." />;
  }

  const handleCopy = async (close: (event: any) => void) => {
    await Clipboard.setStringAsync(currentTransaction.paymentRequest);
    copyPopup('lightningAddress', { onClose: () => close({}) });
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
            data={[{ name: 'Lightning', value: currentTransaction.paymentRequest }]}
            unit={currentTransaction.unit}
            copyTarget="lightningAddress"
          />
        )}

        {isPaid && <TransactionLocationSection transactionId={currentTransaction.id} />}

        {!isPaid ? (
          <MintSelector
            width={280}
            unit={currentTransaction.unit}
            selectedMintUrl={selectedMintUrl}
            onMintSelected={onMintSelected ?? (() => {})}
            onRequestMintList={onRequestMintList ?? (() => {})}
          />
        ) : mintInfo ? (
          <HistoryEntryRefresh mintInfo={mintInfo} historyEntry={currentTransaction} />
        ) : null}

        {currentTransaction.metadata?.memo && (
          <Card message={currentTransaction.metadata.memo} variant="info" />
        )}

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
