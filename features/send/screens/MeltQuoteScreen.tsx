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

import React, { useEffect, useMemo, useRef } from 'react';

import type { MeltHistoryEntry } from 'coco-cashu-core';

import { MintSelector } from '@/features/wallet';
import {
  HistoryEntryHeader,
  HistoryEntryRefresh,
  HistoryEntryTimeline,
  useTransactionSource,
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
import { convertTime } from '@/shared/lib/time';
import { debugLog } from '@/shared/lib/debugLog';
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
  useEffect(() => {
    debugLog({
      location: 'MeltQuoteScreen',
      message: 'MeltQuoteScreen mounted',
      phase: 'entry',
      data: {
        hasMeltHistoryEntry: !!meltHistoryEntry,
        operationId: operationId ?? null,
      },
    });
  }, [meltHistoryEntry, operationId]);

  const extraContext = useMemo(() => (operationId ? { operationId } : undefined), [operationId]);
  const { entry, error, actions } = useScreenActions<'meltQuote', MeltHistoryEntry>(
    'meltQuote',
    meltHistoryEntry,
    extraContext
  );
  const sourceLabel = useTransactionSource(entry?.id);
  const mintInfo = useMintInfo(entry?.mintUrl ?? selectedMintUrl);
  const successRef = useRef(false);

  useBeforeRemoveCleanup({
    active: !!operationId,
    shouldCleanup: () => !successRef.current && !!operationId,
    cleanup: async () => {
      debugLog({
        location: 'MeltQuoteScreen.useBeforeRemoveCleanup',
        message: 'cleanup triggered — executing cancel',
        phase: 'before',
        data: { operationId },
      });
      await actions.cancel.execute();
    },
  });

  if (error) {
    return <ScreenErrorState message={error} onGoBack={onCancel} />;
  }

  if (!entry) {
    return <ScreenLoadingState message="Loading transaction..." />;
  }

  const isPaid = entry.state === 'PAID';
  const isUnpaid = entry.state === 'UNPAID';
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
              condition: isPaid,
            },
            {
              text: actions.pay.loading ? 'Sending...' : 'Pay',
              icon: actions.pay.loading ? 'ri:loader-line' : 'ri:send-plane-2-fill',
              variant: 'primary',
              onPress: async (close: any) => {
                debugLog({
                  location: 'MeltQuoteScreen.pay',
                  message: 'Pay button pressed — executing actions.pay',
                  phase: 'before',
                  data: { isPreview, quoteId: entry?.quoteId },
                });
                await actions.pay.execute();
                successRef.current = true;
                debugLog({
                  location: 'MeltQuoteScreen.pay',
                  message: 'Pay completed — success',
                  phase: 'after',
                  data: { quoteId: entry?.quoteId },
                });
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
                debugLog({
                  location: 'MeltQuoteScreen.cancel',
                  message: 'Cancel button pressed — executing actions.cancel',
                  phase: 'before',
                  data: { quoteId: entry?.quoteId },
                });
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

        {isUnpaid ? (
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
            sourceLabel && { title: 'Source', value: sourceLabel },
            { title: 'Date', value: convertTime(new Date(entry.createdAt)) },
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
