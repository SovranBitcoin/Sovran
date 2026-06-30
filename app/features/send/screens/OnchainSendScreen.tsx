/**
 * @fileoverview Shared Onchain send screen component.
 *
 * The underlying Cashu operation is still a melt quote. Onchain melt
 * execution is not enabled yet, so this screen is a dedicated rail boundary
 * that can show the prepared/unsupported state without overloading the
 * Lightning send UI.
 */

import React from 'react';

import type { MeltHistoryEntry } from '@cashu/coco-core';
import { useScreenActions } from 'wallet/react';

import { Bip321MethodIcons, HistoryEntryHeader, useBip321Info } from '@/features/transactions';
import { getOnchainMeltAddress } from '@/shared/lib/cashu/onchainMelt';
import { formatAmount } from '@/shared/lib/currency';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
import { truncateMiddle } from '@/shared/lib/strings';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { Card } from '@/shared/ui/composed/Card';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { Screen } from '@/shared/ui/composed/Screen';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import { View } from '@/shared/ui/primitives/View/View';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';

interface OnchainSendScreenProps {
  meltHistoryEntry?: MeltHistoryEntry | string;
  onCancel: () => void;
}

export function OnchainSendScreen({ meltHistoryEntry, onCancel }: OnchainSendScreenProps) {
  useLifecycleLogger('OnchainSendScreen');
  const { entry, error, actions, source, mintUrl } = useScreenActions(
    'meltQuote',
    meltHistoryEntry
  );
  const bip321 = useBip321Info(entry?.id);

  if (error) {
    log.warn('send.onchain.error', { error });
    return <ScreenErrorState message={error} onGoBack={onCancel} />;
  }

  if (!entry) {
    return <ScreenLoadingState message="Loading transaction..." />;
  }

  const anyLoading = actions.cancel.loading;
  const onchainAddress = getOnchainMeltAddress(entry);

  const bottomButtons = (
    <BottomButtons>
      <HStack justify="center" align="center">
        <ButtonHandler
          buttons={[
            {
              testID: 'onchain-send-close',
              text: 'Close',
              icon: 'ri:close-circle-line',
              variant: 'secondary',
              onPress: async () => onCancel(),
            },
            {
              testID: 'onchain-send-cancel',
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
    <Screen name="OnchainSendScreen" contentPadding={0} footer={bottomButtons}>
      <View testID={`onchain-send-id-${entry.id}`}>
        <VStack gap={12}>
          <HistoryEntryHeader historyEntry={entry} showRecipientAvatar={false} />

          <Card
            title="Onchain send unavailable"
            message="Onchain send is not supported yet."
            variant="warning"
          />

          <DetailsSection
            items={[
              source && { title: 'Source', value: source },
              bip321.isBip321 && { title: 'Format', value: 'BIP 321' },
              bip321.optionKinds && {
                title: 'Payment Methods',
                value: <Bip321MethodIcons optionKinds={bip321.optionKinds} usedKind="onchain" />,
              },
              { title: 'Date', value: entry.createdAt.datetime },
              { title: 'Amount', value: formatAmount({ amount: entry.amount, unit: entry.unit }) },
              { title: 'State', value: entry.state },
              entry.quoteId && { title: 'Quote ID', value: truncateMiddle(entry.quoteId, 7) },
              onchainAddress && {
                title: 'Destination',
                value: truncateMiddle(onchainAddress, 12),
              },
              mintUrl && { title: 'Mint', value: truncateMiddle(mintUrl, 12) },
            ].flatMap((item) => (item ? [item] : []))}
          />
        </VStack>
      </View>
    </Screen>
  );
}
