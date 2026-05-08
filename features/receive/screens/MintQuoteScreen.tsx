/**
 * @fileoverview Shared MintQuote screen component
 *
 * Display component for Lightning mint quotes (receiving). Actions (copy, share)
 * are handled by the screen-action system.
 */

import React, { useEffect } from 'react';
import { useWindowDimensions } from 'react-native';

import { router } from 'expo-router';

import type { MintHistoryEntry } from '@cashu/coco-core';
import { useScreenActions } from 'coco-payment-ux/react';
import { paymentLog, useLifecycleLogger } from '@/shared/lib/logger';

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
import { Screen } from '@/shared/ui/composed/Screen';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import { useMintInfo } from '@/shared/hooks/useMintInfo';

const QUOTE_CARD_HORIZONTAL_MARGIN = 16;

interface MintQuoteScreenProps {
  mintHistoryEntry: MintHistoryEntry | string;
  extraButtons?: ButtonHandlerButton[];
  onRequestMintList?: () => void;
}

export function MintQuoteScreen({
  mintHistoryEntry,
  extraButtons = [],
  onRequestMintList,
}: MintQuoteScreenProps) {
  useLifecycleLogger('MintQuoteScreen');
  const { width: windowWidth } = useWindowDimensions();
  const { entry, error, actions, source, mintUrl } = useScreenActions(
    'mintQuote',
    mintHistoryEntry
  );
  const mintInfo = useMintInfo(entry?.mintUrl);
  const bip321 = useBip321Info(entry?.id);

  useEffect(() => {
    if (error) paymentLog.warn('receive.mint_quote.error', { error });
  }, [error]);

  const isPaid = entry?.state === 'ISSUED' || entry?.state === 'PAID';
  const quoteCardWidth = Math.max(0, windowWidth - QUOTE_CARD_HORIZONTAL_MARGIN * 2);

  useEffect(() => {
    if (!entry) return;
    paymentLog.debug('receive.mint_quote.render', {
      state: entry.state,
      isPaid,
      amount: entry.amount,
      unit: entry.unit,
    });
  }, [entry, isPaid]);

  if (error) {
    return <ScreenErrorState message={error} onGoBack={() => router.back()} />;
  }

  if (!entry) {
    return <ScreenLoadingState message="Loading transaction..." />;
  }

  const bottomButtons = (
    <BottomButtons>
      <HStack justify="center" align="center">
        <ButtonHandler
          buttons={[
            {
              text: 'Copy',
              icon: 'lets-icons:copy',
              variant: 'primary',
              onPress: () => actions.copy.execute(),
              condition: actions.copy.available,
            },
            {
              text: 'Share',
              icon: 'ri:share-fill',
              variant: 'secondary',
              onPress: () => actions.share.execute(),
              condition: actions.share.available,
            },
            ...extraButtons.map((button) => ({ ...button, condition: !isPaid })),
          ]}
        />
      </HStack>
    </BottomButtons>
  );

  return (
    <Screen name="MintQuoteScreen" contentPadding={0} footer={bottomButtons}>
      {/*
       * Id marker wraps the screen body — lets `phone test` capture
       * the entry id of the mint currently being viewed via
       * `capture #mint-quote-id-* suffix`. Without this, tests have
       * to guess which row on the wallet home corresponds to the one
       * they just created, and `findByTestIDPrefix` returns the
       * visually topmost match — which on the wallet home is a
       * pending mint, not the newly confirmed one (home renders
       * Pending → Confirmed top-to-bottom). Wrapping the VStack
       * (rather than a zero-sized sibling) guarantees a non-zero rect
       * so the node appears in the iOS AX tree. Snapshots comparing
       * this screen to itself within the same run see the same id on
       * both sides so snapshot equality holds.
       */}
      <View testID={`mint-quote-id-${entry.id}`}>
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
              width={quoteCardWidth}
              unit={entry.unit}
              selectedMintUrl={mintUrl}
              onRequestMintList={onRequestMintList}
            />
          ) : mintInfo ? (
            <HistoryEntryRefresh mintInfo={mintInfo} historyEntry={entry} />
          ) : null}

          {entry.metadata?.memo && <Card message={entry.metadata.memo} variant="info" />}

          <HistoryEntryTimeline historyEntry={entry} />

          <DetailsSection
            items={[
              entry.id && { title: 'ID', value: entry.id },
              source && { title: 'Source', value: source },
              bip321.isBip321 && { title: 'Format', value: 'BIP 321' },
              bip321.optionKinds && {
                title: 'Payment Methods',
                value: <Bip321MethodIcons optionKinds={bip321.optionKinds} usedKind="lightning" />,
              },
              { title: 'Date', value: entry.createdAt.datetime },
              {
                title: 'Amount',
                value: formatAmount({ amount: entry.amount, unit: entry.unit }),
              },
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
      </View>
    </Screen>
  );
}
