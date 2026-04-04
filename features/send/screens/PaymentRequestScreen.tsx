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

import type { SendHistoryEntry } from '@cashu/coco-core';
import { isPaymentRequestPreview } from 'coco-payment-ux';
import { useScreenActions } from 'coco-payment-ux/react';
import { MintSelector } from '@/features/wallet';
import { formatAmount } from '@/shared/lib/currency';
import { truncateMiddle } from '@/shared/lib/strings';
import {
  HistoryEntryHeader,
  HistoryEntryRefresh,
  HistoryEntryTimeline,
  useBip321Info,
  Bip321MethodIcons,
} from '@/features/transactions';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import { ModalLayoutWrapper } from '@/shared/ui/composed/ModalLayoutWrapper';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { useMintInfo } from '@/shared/hooks/useMintInfo';

interface PaymentRequestScreenProps {
  paymentRequestEntry?: SendHistoryEntry | string;
  onCancel: () => void;
  onMintSelected?: (mintUrl: string) => void;
  onRequestMintList?: () => void;
}

export function PaymentRequestScreen({
  paymentRequestEntry,
  onCancel,
  onMintSelected,
  onRequestMintList,
}: PaymentRequestScreenProps) {
  const { entry, error, actions, source, mintUrl } = useScreenActions('paymentRequest', paymentRequestEntry);
  const mintInfo = useMintInfo(entry?.mintUrl);
  const bip321 = useBip321Info(entry?.id);

  if (error) {
    return <ScreenErrorState message={error} onGoBack={onCancel} />;
  }

  if (!entry) {
    return <ScreenLoadingState message="Loading payment request..." />;
  }

  const tokenCreated = entry.metadata?.tokenCreated === 'true';
  const nostrSent = entry.metadata?.nostrSent === 'true';
  const isPreview = isPaymentRequestPreview(entry);

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

        {isPreview ? (
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

        <HistoryEntryTimeline
          historyEntry={entry}
          tokenCreated={tokenCreated}
          nostrSent={nostrSent}
        />

        <DetailsSection
          items={[
            source ? { title: 'Source', value: source } : null,
            bip321.isBip321 ? { title: 'Format', value: 'BIP 321' } : null,
            bip321.optionKinds ? { title: 'Payment Methods', value: <Bip321MethodIcons optionKinds={bip321.optionKinds} usedKind="ecash" /> } : null,
            { title: 'Date', value: entry.createdAt.datetime },
            { title: 'Amount', value: formatAmount({ amount: entry.amount, unit: entry.unit }) },
            entry.transportLabel ? { title: 'Transport', value: entry.transportLabel } : null,
            entry.paymentRequestInfo?.mints?.length
              ? {
                  title: 'Allowed Mints',
                  value: `${entry.paymentRequestInfo.mints.length} mint(s)`,
                }
              : null,
            entry.operationId
              ? { title: 'Operation ID', value: truncateMiddle(entry.operationId, 7) }
              : null,
            mintUrl ? { title: 'Mint', value: truncateMiddle(mintUrl, 12) } : null,
          ].flatMap((item) => (item ? [item] : []))}
        />
      </VStack>
    </ModalLayoutWrapper>
  );
}
