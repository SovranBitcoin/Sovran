/**
 * @fileoverview Shared MintQuote screen component
 *
 * Display component for Lightning mint quotes (receiving). Actions (copy, share)
 * are handled by the screen-action system.
 */

import React from 'react';

import { router } from 'expo-router';

import type { MintHistoryEntry } from '@cashu/coco-core';
import { useScreenActions } from 'coco-payment-ux/react';
import { log, useLifecycleLogger, Screen } from '@/shared/lib/logger';

import { MintSelector } from '@/features/wallet';
import { formatAmount } from '@/shared/lib/currency';
import { truncateMiddle } from '@/shared/lib/strings';
import {
  HistoryEntryHeader,
  HistoryEntryRefresh,
  HistoryEntryTimeline,
  TransactionLocationSection,
  useBip321Info,
  Bip321MethodIcons,
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
  mintHistoryEntry: MintHistoryEntry | string;
  extraButtons?: ButtonHandlerButton[];
  onMintSelected?: (mintUrl: string) => void;
  onRequestMintList?: () => void;
}

export function MintQuoteScreen({
  mintHistoryEntry,
  extraButtons = [],
  onMintSelected,
  onRequestMintList,
}: MintQuoteScreenProps) {
  useLifecycleLogger('MintQuoteScreen');
  const { entry, error, actions, source, mintUrl } = useScreenActions('mintQuote', mintHistoryEntry);
  const mintInfo = useMintInfo(entry?.mintUrl);
  const bip321 = useBip321Info(entry?.id);

  if (error) {
    log.warn('receive.mint_quote.error', { error });
    return <ScreenErrorState message={error} onGoBack={() => router.back()} />;
  }

  if (!entry) {
    return <ScreenLoadingState message="Loading transaction..." />;
  }

  const isPaid = entry.state === 'ISSUED' || entry.state === 'PAID';
  log.debug('receive.mint_quote.render', { state: entry.state, isPaid, amount: entry.amount, unit: entry.unit });

  const bottomButtons = (
    <BottomButtons>
      <HStack justify="center" align="center">
        <ButtonHandler
          buttons={[
            {
              text: 'Copy',
              icon: 'lets-icons:copy',
              variant: 'primary',
              onPress: async (close: any) => {
                await actions.copy.execute();
                close({});
              },
              condition: actions.copy.available,
            },
            {
              text: 'Share',
              icon: 'ri:share-fill',
              variant: 'secondary',
              onPress: async (close: any) => {
                await actions.share.execute();
                close({});
              },
              condition: actions.share.available,
            },
            ...extraButtons.map((button) => ({ ...button, condition: !isPaid })),
          ]}
        />
      </HStack>
    </BottomButtons>
  );

  return (
    <ModalLayoutWrapper contentPadding={0} bottomContent={bottomButtons}>
      <Screen name="MintQuoteScreen">
        <VStack gap={12}>
          <HistoryEntryHeader historyEntry={entry} />
          {!isPaid && (
            <PaymentInfo
              data={[{ name: 'Lightning', value: entry.paymentRequest }]}
              unit={entry.unit}
              copyTarget="paymentRequest"
            />
          )}

          {isPaid && <TransactionLocationSection transactionId={entry.id} />}

          {!isPaid ? (
            <MintSelector
              width={280}
              unit={entry.unit}
              selectedMintUrl={mintUrl}
              onMintSelected={onMintSelected ?? (() => {})}
              onRequestMintList={onRequestMintList ?? (() => {})}
            />
          ) : mintInfo ? (
            <HistoryEntryRefresh mintInfo={mintInfo} historyEntry={entry} />
          ) : null}

          {entry.metadata?.memo && <Card message={entry.metadata.memo} variant="info" />}

          <HistoryEntryTimeline historyEntry={entry} />

          <DetailsSection
            items={[
              source && { title: 'Source', value: source },
              bip321.isBip321 && { title: 'Format', value: 'BIP 321' },
              bip321.optionKinds && { title: 'Payment Methods', value: <Bip321MethodIcons optionKinds={bip321.optionKinds} usedKind="lightning" /> },
              { title: 'Date', value: entry.createdAt.datetime },
              { title: 'Amount', value: formatAmount({ amount: entry.amount, unit: entry.unit }) },
              { title: 'State', value: entry.state },
              entry.quoteId && { title: 'Quote ID', value: truncateMiddle(entry.quoteId, 7) },
              mintUrl && { title: 'Mint', value: truncateMiddle(mintUrl, 12) },
              {
                title: 'Invoice',
                value: truncateMiddle(entry.paymentRequest, 10),
              },
            ].flatMap((item) => (item ? [item] : []))}
          />
        </VStack>
      </Screen>
    </ModalLayoutWrapper>
  );
}
