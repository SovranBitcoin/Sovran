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

import React, { useMemo, useRef } from 'react';

import type { MeltHistoryEntry } from 'coco-cashu-core';

import { MintSelector } from '@/features/wallet';
import {
  HistoryEntryHeader,
  HistoryEntryRefresh,
  HistoryEntryTimeline,
} from '@/features/transactions';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import { ModalLayoutWrapper } from '@/shared/ui/composed/ModalLayoutWrapper';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { formatAmount } from '@/shared/lib/currency';
import { truncateMiddle } from '@/shared/lib/strings';
import { useMintInfo } from '@/shared/hooks/useMintInfo';
import { useScreenActions } from '@/shared/hooks/useScreenActions';
import { useBeforeRemoveCleanup } from '@/shared/hooks/useBeforeRemoveCleanup';

interface MeltQuoteScreenProps {
  meltHistoryEntry?: MeltHistoryEntry | string;
  operationId?: string;
  selectedMintUrl?: string;
  onCancel: () => void;
  onSendSuccess?: () => void;
  onMintSelected?: (mintUrl: string) => void;
  onRequestMintList?: () => void;
}

export function MeltQuoteScreen({
  meltHistoryEntry,
  operationId,
  selectedMintUrl,
  onCancel,
  onSendSuccess,
  onMintSelected,
  onRequestMintList,
}: MeltQuoteScreenProps) {
  const enrichedEntry = useMemo(() => {
    if (!meltHistoryEntry || !operationId) return meltHistoryEntry;
    const parsed =
      typeof meltHistoryEntry === 'string'
        ? (JSON.parse(meltHistoryEntry) as MeltHistoryEntry)
        : meltHistoryEntry;
    return { ...parsed, metadata: { ...parsed.metadata, operationId } };
  }, [meltHistoryEntry, operationId]);

  const { entry, error, actions, source } = useScreenActions<'meltQuote', MeltHistoryEntry>(
    'meltQuote',
    enrichedEntry
  );
  const mintInfo = useMintInfo(entry?.mintUrl);
  const successRef = useRef(false);

  const hasOperation = !!entry?.metadata?.operationId;
  useBeforeRemoveCleanup({
    active: hasOperation,
    shouldCleanup: () => !successRef.current && hasOperation,
    cleanup: async () => {
      await actions.cancel.execute();
    },
  });

  if (error) {
    return <ScreenErrorState message={error} onGoBack={onCancel} />;
  }

  if (!entry) {
    return <ScreenLoadingState message="Loading transaction..." />;
  }

  const isPreview = !entry.quoteId;
  const anyLoading = actions.pay.loading || actions.cancel.loading;

  const bottomButtons = (
    <BottomButtons>
      <HStack justify="center" align="center">
        <ButtonHandler
          buttons={[
            {
              text: 'Close',
              icon: 'ri:close-circle-line',
              variant: 'secondary',
              onPress: async () => onCancel(),
              condition: entry.state === 'PAID',
            },
            {
              text: actions.pay.loading ? 'Sending...' : 'Pay',
              icon: actions.pay.loading ? 'ri:loader-line' : 'ri:send-plane-2-fill',
              variant: 'primary',
              onPress: async (close: any) => {
                await actions.pay.execute();
                successRef.current = true;
                onSendSuccess?.();
                close({});
              },
              condition: actions.pay.available,
              disabled: anyLoading,
            },
            {
              text: actions.cancel.loading ? 'Cancelling...' : 'Cancel',
              icon: actions.cancel.loading ? 'ri:loader-line' : 'ri:close-circle-line',
              variant: 'secondary',
              onPress: async (close: any) => {
                await actions.cancel.execute();
                onCancel();
                close({});
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
    <ModalLayoutWrapper contentPadding={0} bottomContent={bottomButtons}>
      <VStack gap={12}>
        <HistoryEntryHeader historyEntry={entry} />

        {entry.state === 'UNPAID' ? (
          <MintSelector
            width={280}
            unit={entry.unit}
            selectedMintUrl={selectedMintUrl}
            onMintSelected={onMintSelected ?? (() => {})}
            onRequestMintList={onRequestMintList ?? (() => {})}
          />
        ) : mintInfo ? (
          <HistoryEntryRefresh mintInfo={mintInfo} historyEntry={entry} />
        ) : null}

        <HistoryEntryTimeline historyEntry={entry} />

        <DetailsSection
          items={[
            source && { title: 'Source', value: source },
            { title: 'Date', value: entry.createdAt.datetime },
            !isPreview && { title: 'Quote ID', value: truncateMiddle(entry.quoteId, 7) },
            isPreview &&
              entry.metadata?.meltTarget && {
                title: 'Destination',
                value: truncateMiddle(entry.metadata.meltTarget, 12),
              },
            {
              title: 'Amount',
              value: formatAmount({ amount: entry.amount, unit: entry.unit }),
            },
          ].flatMap((item) => (item ? [item] : []))}
        />
      </VStack>
    </ModalLayoutWrapper>
  );
}
