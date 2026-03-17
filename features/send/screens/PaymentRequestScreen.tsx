/**
 * @fileoverview Payment Request screen component
 *
 * Display component for NUT-18 Cashu payment requests. Shows the payment
 * details before execution and progress after the user confirms.
 *
 * Actions (confirm, cancel) are handled by the screen-action system; this
 * screen only renders UI and wires buttons. The confirm action handles
 * transport selection (HTTP POST, Nostr NIP-17, or inband) internally.
 */

import React from 'react';

import type { SendHistoryEntry } from 'coco-cashu-core';

import { MintSelector } from '@/features/wallet';
import { HistoryEntryHeader, HistoryEntryTimeline } from '@/features/transactions';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import { ModalLayoutWrapper } from '@/shared/ui/composed/ModalLayoutWrapper';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { useScreenActions } from '@/shared/hooks/useScreenActions';

interface PaymentRequestScreenProps {
  paymentRequestEntry?: string;
  selectedMintUrl?: string;
  onCancel: () => void;
  onMintSelected?: (mintUrl: string) => void;
  onRequestMintList?: () => void;
}

export function PaymentRequestScreen({
  paymentRequestEntry,
  selectedMintUrl,
  onCancel,
  onMintSelected,
  onRequestMintList,
}: PaymentRequestScreenProps) {
  const { entry, error, actions, source } = useScreenActions('paymentRequest', paymentRequestEntry);

  if (error) {
    return <ScreenErrorState message={error} onGoBack={onCancel} />;
  }

  if (!entry) {
    return <ScreenLoadingState message="Loading payment request..." />;
  }

  const phase = entry.metadata?.phase;
  const tokenCreated = entry.metadata?.tokenCreated === 'true';
  const nostrSent = entry.metadata?.nostrSent === 'true';
  const isPreview = phase === 'preview' || !phase;

  const anyLoading = actions.confirm.loading || actions.cancel.loading;

  const bottomButtons = (
    <BottomButtons>
      <HStack justify="center" align="center">
        <ButtonHandler
          buttons={[
            {
              text: actions.confirm.loading ? 'Sending...' : 'Confirm',
              icon: actions.confirm.loading ? 'ri:loader-line' : 'ri:send-plane-2-fill',
              variant: 'primary',
              onPress: async (close: any) => {
                await actions.confirm.execute();
                close({});
              },
              condition: actions.confirm.available,
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
        <HistoryEntryHeader
          pendingData={{ amount: entry.amount, unit: entry.unit, type: 'send' }}
        />

        {isPreview && (
          <MintSelector
            width={280}
            unit={entry.unit}
            selectedMintUrl={selectedMintUrl}
            onMintSelected={onMintSelected ?? (() => {})}
            onRequestMintList={onRequestMintList ?? (() => {})}
          />
        )}

        <HistoryEntryTimeline
          historyEntry={entry as unknown as SendHistoryEntry}
          tokenCreated={tokenCreated}
          nostrSent={nostrSent}
        />

        <DetailsSection
          items={[
            source ? { title: 'Source', value: source } : null,
            { title: 'Date', value: entry.createdAt.datetime },
            entry.transportLabel ? { title: 'Transport', value: entry.transportLabel } : null,
            entry.paymentRequestInfo?.mints?.length
              ? {
                  title: 'Allowed Mints',
                  value: `${entry.paymentRequestInfo.mints.length} mint(s)`,
                }
              : null,
            !isPreview && entry.mintUrl ? { title: 'Mint', value: entry.mintUrl } : null,
          ].flatMap((item) => (item ? [item] : []))}
        />
      </VStack>
    </ModalLayoutWrapper>
  );
}
