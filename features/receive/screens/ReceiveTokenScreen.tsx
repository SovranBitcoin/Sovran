/**
 * @fileoverview Shared ReceiveToken screen component
 *
 * Uses the screen-action system for entry tracking, redeem availability, and
 * execution. All redeem logic (mint trust check, payment toast, P2PK rotation,
 * scan history linking) is handled by the receiveToken.redeem handler.
 */

import React from 'react';

import type { ReceiveHistoryEntry } from '@cashu/coco-core';
import { useScreenActions } from 'coco-payment-ux/react';
import { log, useLifecycleLogger, Screen } from '@/shared/lib/logger';
import {
  HistoryEntryHeader,
  HistoryEntryRefresh,
  HistoryEntryTimeline,
  TransactionLocationSection,
  useBip321Info,
  Bip321MethodIcons,
} from '@/features/transactions';
import { formatAmount } from '@/shared/lib/currency';
import { truncateMiddle } from '@/shared/lib/strings';
import { ModalLayoutWrapper } from '@/shared/ui/composed/ModalLayoutWrapper';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { useMintInfo } from '@/shared/hooks/useMintInfo';

interface ReceiveTokenScreenProps {
  receiveHistoryEntry?: ReceiveHistoryEntry | string;
  onNavigateBack: () => void;
}

export function ReceiveTokenScreen({
  receiveHistoryEntry,
  onNavigateBack,
}: ReceiveTokenScreenProps) {
  useLifecycleLogger('ReceiveTokenScreen');
  const { entry, error, actions, source, mintUrl } = useScreenActions('receiveToken', receiveHistoryEntry);
  const mintInfo = useMintInfo(entry?.mintUrl);
  const bip321 = useBip321Info(entry?.id);

  if (error) {
    log.warn('receive.token.error', { error });
    return <ScreenErrorState message={error} onGoBack={onNavigateBack} />;
  }

  if (!entry) {
    return <ScreenLoadingState message="Loading transaction..." />;
  }

  const isRedeemed = !(entry.id?.startsWith('receive-') ?? false);
  log.debug('receive.token.render', { isRedeemed, amount: entry.amount, unit: entry.unit });

  const bottomButtons = (
    <BottomButtons>
      <ButtonHandler
        buttons={[
          {
            text: 'Close',
            icon: 'ri:close-circle-line',
            variant: 'secondary',
            onPress: async () => onNavigateBack(),
            condition: isRedeemed,
          },
          {
            text: 'Cancel',
            variant: 'secondary',
            onPress: async () => onNavigateBack(),
            condition: !isRedeemed,
          },
          {
            text: actions.redeem.loading ? 'Redeeming...' : 'Redeem Ecash',
            variant: 'primary',
            onPress: async () => {
              await actions.redeem.execute();
            },
            loading: actions.redeem.loading,
            condition: actions.redeem.available,
          },
        ]}
      />
    </BottomButtons>
  );

  return (
    <ModalLayoutWrapper contentPadding={0} bottomContent={bottomButtons}>
      <Screen name="ReceiveTokenScreen">
        <VStack gap={12}>
          <HistoryEntryHeader historyEntry={entry} />

          {isRedeemed && <TransactionLocationSection transactionId={entry.id} />}

          <HistoryEntryRefresh historyEntry={entry} mintInfo={mintInfo} />

          <HistoryEntryTimeline
            historyEntry={
              { ...entry, state: isRedeemed ? 'redeemed' : 'pending' } as ReceiveHistoryEntry
            }
          />

          <DetailsSection
            items={[
              source && { title: 'Source', value: source },
              bip321.isBip321 && { title: 'Format', value: 'BIP 321' },
              bip321.optionKinds && { title: 'Payment Methods', value: <Bip321MethodIcons optionKinds={bip321.optionKinds} usedKind="ecash" /> },
              { title: 'Date', value: entry.createdAt.datetime },
              { title: 'Amount', value: formatAmount({ amount: entry.amount, unit: entry.unit }) },
              mintUrl && { title: 'Mint', value: truncateMiddle(mintUrl, 12) },
              entry.p2pkPubkey && { title: 'P2PK', value: entry.p2pkPubkey.truncate(8) },
              entry.tokenString && { title: 'Token', value: entry.tokenString.truncate(6) },
            ].flatMap((item) => (item ? [item] : []))}
          />
        </VStack>
      </Screen>
    </ModalLayoutWrapper>
  );
}
