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
import { StyleSheet } from 'react-native';

import type { SendHistoryEntry } from '@cashu/coco-core';
import { isPaymentRequestPreview } from 'wallet';
import { useScreenActions } from 'wallet/react';
import { MintSelector } from '@/features/wallet';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
import { formatAmount } from '@/shared/lib/currency';
import { truncateMiddle } from '@/shared/lib/strings';
import {
  HistoryEntryHeader,
  HistoryEntryRefresh,
  HistoryEntryTimeline,
  useBip321Info,
  Bip321MethodIcons,
} from '@/features/transactions';
import { TransactionProbe } from '@/features/transactions/components/detail/TransactionProbe';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import { Screen } from '@/shared/ui/composed/Screen';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { useMintInfo } from '@/shared/hooks/useMintInfo';

interface PaymentRequestScreenProps {
  paymentRequestEntry?: SendHistoryEntry | string;
  onCancel: () => void;
  onRequestMintList?: () => void;
}

export function PaymentRequestScreen({
  paymentRequestEntry,
  onCancel,
  onRequestMintList,
}: PaymentRequestScreenProps) {
  useLifecycleLogger('PaymentRequestScreen');
  const { entry, error, actions, source, mintUrl } = useScreenActions(
    'paymentRequest',
    paymentRequestEntry
  );
  const mintInfo = useMintInfo(entry?.mintUrl);
  const bip321 = useBip321Info(entry?.id);

  if (error) {
    log.warn('send.payment_request.error', { error });
    return <ScreenErrorState message={error} onGoBack={onCancel} />;
  }

  if (!entry) {
    return <ScreenLoadingState message="Loading payment request..." />;
  }

  const tokenCreated = entry.metadata?.tokenCreated === 'true';
  const nostrSent = entry.metadata?.nostrSent === 'true';
  const isPreview = isPaymentRequestPreview({ ...entry } as Record<string, unknown>);
  log.debug('send.payment_request.render', {
    isPreview,
    amount: entry.amount,
    unit: entry.unit,
    tokenCreated,
    nostrSent,
  });

  const anyLoading = actions.confirm.loading || actions.cancel.loading || actions.back.loading;

  const bottomButtons = (
    <BottomButtons>
      <HStack justify="center" align="center">
        <ButtonHandler
          buttons={[
            {
              testID: 'payment-request-close',
              text: 'Close',
              icon: 'ri:close-circle-line',
              variant: 'secondary',
              onPress: () => actions.back.execute(),
              condition: !isPreview && actions.back.available,
              disabled: anyLoading,
            },
            {
              testID: 'payment-request-confirm',
              text: actions.confirm.loading ? 'Sending...' : 'Confirm',
              icon: actions.confirm.loading ? 'ri:loader-line' : 'ri:send-plane-2-fill',
              variant: 'primary',
              onPress: () => actions.confirm.execute(),
              condition: actions.confirm.available,
              disabled: anyLoading,
            },
            {
              testID: 'payment-request-cancel',
              text: actions.cancel.loading ? 'Cancelling...' : 'Cancel',
              icon: actions.cancel.loading ? 'ri:loader-line' : 'ri:close-circle-line',
              variant: 'secondary',
              onPress: onCancel,
              condition: actions.cancel.available,
              disabled: anyLoading,
            },
          ]}
        />
      </HStack>
    </BottomButtons>
  );

  return (
    <Screen name="PaymentRequestScreen" contentPadding={0} footer={bottomButtons}>
      <View
        testID="payment-request-ready"
        accessible
        accessibilityRole="text"
        accessibilityLabel="Payment request ready"
        importantForAccessibility="yes"
        collapsable={false}
        pointerEvents="none"
        style={styles.routeReadyProbe}
      />
      <TransactionProbe entry={entry} source={source} transactionId={entry.id} />
      <VStack gap={12}>
        <HistoryEntryHeader
          pendingData={{ amount: entry.amount, unit: entry.unit, type: 'send' }}
          showRecipientAvatar={false}
        />

        {isPreview ? (
          <MintSelector
            width={280}
            unit={entry.unit}
            selectedMintUrl={mintUrl}
            onRequestMintList={onRequestMintList}
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
            bip321.optionKinds
              ? {
                  title: 'Payment Methods',
                  value: <Bip321MethodIcons optionKinds={bip321.optionKinds} usedKind="ecash" />,
                }
              : null,
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  routeReadyProbe: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 1,
    height: 1,
  },
});
