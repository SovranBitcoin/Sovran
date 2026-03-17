/**
 * @fileoverview Shared ReceiveToken screen component
 *
 * Uses the screen-action system for entry tracking, redeem availability, and
 * execution. All redeem logic (mint trust check, payment toast, P2PK rotation,
 * scan history linking) is handled by the receiveToken.redeem handler.
 */

import React from 'react';

import type { ReceiveHistoryEntry } from 'coco-cashu-core';

import {
  HistoryEntryHeader,
  HistoryEntryRefresh,
  HistoryEntryTimeline,
  TransactionLocationSection,
} from '@/features/transactions';
import { ModalLayoutWrapper } from '@/shared/ui/composed/ModalLayoutWrapper';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { useMintInfo } from '@/shared/hooks/useMintInfo';
import { useScreenActions } from '@/shared/hooks/useScreenActions';

interface ReceiveTokenScreenProps {
  receiveHistoryEntry?: ReceiveHistoryEntry | string;
  onNavigateBack: () => void;
}

export function ReceiveTokenScreen({
  receiveHistoryEntry,
  onNavigateBack,
}: ReceiveTokenScreenProps) {
  const { entry, error, actions, source } = useScreenActions<'receiveToken', ReceiveHistoryEntry>(
    'receiveToken',
    receiveHistoryEntry
  );
  const mintInfo = useMintInfo(entry?.mintUrl);

  if (error) {
    return <ScreenErrorState message={error} onGoBack={onNavigateBack} />;
  }

  if (!entry) {
    return <ScreenLoadingState message="Loading transaction..." />;
  }

  const isRedeemed = !(entry.id?.startsWith('receive-') ?? false);

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
      <VStack gap={12}>
        <HistoryEntryHeader historyEntry={entry} />

        {isRedeemed && <TransactionLocationSection transactionId={entry.id} />}

        {mintInfo && <HistoryEntryRefresh historyEntry={entry} mintInfo={mintInfo} />}

        <HistoryEntryTimeline
          historyEntry={
            { ...entry, state: isRedeemed ? 'redeemed' : 'pending' } as ReceiveHistoryEntry
          }
        />

        <DetailsSection
          items={[
            source && { title: 'Source', value: source },
            entry.p2pkPubkey && { title: 'P2PK', value: entry.p2pkPubkey.truncate(8) },
            entry.tokenString && { title: 'Token', value: entry.tokenString.truncate(6) },
          ].flatMap((item) => (item ? [item] : []))}
        />
      </VStack>
    </ModalLayoutWrapper>
  );
}
