/**
 * @fileoverview Shared MeltQuote screen component
 *
 * Display component for Lightning melt quotes (sending). Supports two phases:
 * - Preview (quoteId='') — synthetic entry, "Pay" runs prepare+execute
 * - Ready (quoteId set) — real entry from history, "Pay" runs execute only
 * - Done (state='PAID') — "Close" button
 *
 * Actions (pay, cancel) are handled by the screen-action system.
 * The navigateToMeltPreview handler navigates here instantly with a synthetic
 * entry; the pay action handles LNURL resolution + prepareMeltBolt11 + executeMelt.
 */

import React from 'react';

import type { MeltHistoryEntry } from '@cashu/coco-core';
import { useScreenActions } from 'coco-payment-ux/react';
import { MintSelector } from '@/features/wallet';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
import {
  HistoryEntryHeader,
  HistoryEntryRefresh,
  HistoryEntryTimeline,
  TransactionLocationSection,
  useBip321Info,
  Bip321MethodIcons,
} from '@/features/transactions';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import { Screen } from '@/shared/ui/composed/Screen';
import { View } from 'react-native';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { formatAmount } from '@/shared/lib/currency';
import { truncateMiddle } from '@/shared/lib/strings';
import { useMintInfo } from '@/shared/hooks/useMintInfo';

interface MeltQuoteScreenProps {
  meltHistoryEntry?: MeltHistoryEntry | string;
  onCancel: () => void;
  onRequestMintList?: () => void;
}

export function MeltQuoteScreen({
  meltHistoryEntry,
  onCancel,
  onRequestMintList,
}: MeltQuoteScreenProps) {
  useLifecycleLogger('MeltQuoteScreen');
  const { entry, error, actions, source, mintUrl } = useScreenActions(
    'meltQuote',
    meltHistoryEntry
  );
  const mintInfo = useMintInfo(entry?.mintUrl);
  const bip321 = useBip321Info(entry?.id);

  if (error) {
    log.warn('send.melt_quote.error', { error });
    return <ScreenErrorState message={error} onGoBack={onCancel} />;
  }

  if (!entry) {
    return <ScreenLoadingState message="Loading transaction..." />;
  }

  const isPreview = !entry.quoteId;
  const anyLoading = actions.pay.loading || actions.cancel.loading;
  log.debug('send.melt_quote.render', {
    state: entry.state,
    isPreview,
    amount: entry.amount,
    unit: entry.unit,
  });

  const bottomButtons = (
    <BottomButtons>
      <HStack justify="center" align="center">
        <ButtonHandler
          buttons={[
            {
              testID: 'melt-close',
              text: 'Close',
              icon: 'ri:close-circle-line',
              variant: 'secondary',
              onPress: async () => onCancel(),
              condition: entry.state === 'PAID',
            },
            {
              testID: 'melt-pay',
              text: actions.pay.loading ? 'Sending...' : 'Pay',
              icon: actions.pay.loading ? 'ri:loader-line' : 'ri:send-plane-2-fill',
              variant: 'primary',
              onPress: () => actions.pay.execute(),
              condition: actions.pay.available,
              disabled: anyLoading,
            },
            {
              testID: 'melt-cancel',
              text: actions.cancel.loading ? 'Cancelling...' : 'Cancel',
              icon: actions.cancel.loading ? 'ri:loader-line' : 'ri:close-circle-line',
              variant: 'secondary',
              onPress: async () => {
                await actions.cancel.execute();
                onCancel();
              },
              condition: actions.cancel.available,
              disabled: anyLoading,
            },
          ]}
        />
      </HStack>
    </BottomButtons>
  );

  return (
    <Screen name="MeltQuoteScreen" contentPadding={0} footer={bottomButtons}>
      <View testID={`melt-quote-id-${entry.id}`}>
        <VStack gap={12}>
          <HistoryEntryHeader historyEntry={entry} />

          {entry.state === 'PAID' && <TransactionLocationSection transactionId={entry.id} />}

          {entry.state === 'UNPAID' ? (
            <MintSelector
              width={280}
              unit={entry.unit}
              selectedMintUrl={mintUrl}
              onRequestMintList={onRequestMintList}
            />
          ) : mintInfo ? (
            <HistoryEntryRefresh mintInfo={mintInfo} historyEntry={entry} />
          ) : null}

          <HistoryEntryTimeline historyEntry={entry} />

          <DetailsSection
            items={[
              source && { title: 'Source', value: source },
              bip321.isBip321 && { title: 'Format', value: 'BIP 321' },
              bip321.optionKinds && {
                title: 'Payment Methods',
                value: <Bip321MethodIcons optionKinds={bip321.optionKinds} usedKind="lightning" />,
              },
              { title: 'Date', value: entry.createdAt.datetime },
              { title: 'Amount', value: formatAmount({ amount: entry.amount, unit: entry.unit }) },
              { title: 'State', value: entry.state },
              entry.quoteId && { title: 'Quote ID', value: truncateMiddle(entry.quoteId, 7) },
              entry.metadata?.meltTarget && {
                title: 'Destination',
                value: truncateMiddle(entry.metadata.meltTarget, 12),
              },
              mintUrl && { title: 'Mint', value: truncateMiddle(mintUrl, 12) },
            ].flatMap((item) => (item ? [item] : []))}
          />
        </VStack>
      </View>
    </Screen>
  );
}
