import React, { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import type { MintInfo } from '@cashu/cashu-ts';
import type { HistoryEntry, MintHistoryEntry } from '@cashu/coco-core';
import { isMintQuotePaymentObserved } from 'colada';
import type { BoundAction } from 'colada/react';

import { MintSelector } from '@/features/wallet';
import {
  Bip321MethodIcons,
  HistoryEntryHeader,
  HistoryEntryRefresh,
  HistoryEntryTimeline,
  TransactionLocationSection,
  useBip321Info,
} from '@/features/transactions';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { useMempoolAddressSummary } from '@/shared/hooks/useMempoolAddressSummary';
import { getOnchainConfirmationProgress } from '@/shared/lib/bitcoin/onchainPaymentStatus';
import {
  buildOnchainRequiredConfirmationProgress,
  buildSatisfiedOnchainConfirmationProgress,
  getMintQuotePaymentValue,
  getOnchainMintAddress,
  getOnchainMintQuoteRequiredConfirmations,
} from '@/shared/lib/cashu/onchainMint';
import { formatAmount } from '@/shared/lib/currency';
import { useLifecycleLogger } from '@/shared/lib/logger';
import { truncateMiddle } from '@/shared/lib/strings';
import type { ButtonHandlerButton } from '@/shared/ui/composed/ButtonHandler';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { Card } from '@/shared/ui/composed/Card';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { Screen } from '@/shared/ui/composed/Screen';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';

const QUOTE_CARD_HORIZONTAL_MARGIN = 16;

export type OnchainReceiveEntry = Omit<MintHistoryEntry, 'createdAt' | 'updatedAt'> & {
  createdAt: { datetime: string };
  updatedAt?: unknown;
};

interface OnchainReceiveScreenProps {
  entry: OnchainReceiveEntry;
  actions: Record<'copy' | 'share', BoundAction>;
  source: string | null;
  mintUrl?: string;
  mintInfo: MintInfo | null;
  extraButtons?: ButtonHandlerButton[];
  onRequestMintList?: () => void;
}

export function OnchainReceiveScreen({
  entry,
  actions,
  source,
  mintUrl,
  mintInfo,
  extraButtons = [],
  onRequestMintList,
}: OnchainReceiveScreenProps) {
  useLifecycleLogger('OnchainReceiveScreen');
  const { width: windowWidth } = useWindowDimensions();
  const onchainAddress = getOnchainMintAddress(entry as unknown as HistoryEntry);
  const mempool = useMempoolAddressSummary(onchainAddress);
  const bip321 = useBip321Info(entry.id);
  const isPaid = isMintQuotePaymentObserved(entry);
  const quoteCardWidth = Math.max(0, windowWidth - QUOTE_CARD_HORIZONTAL_MARGIN * 2);
  const requiredConfirmations = getOnchainMintQuoteRequiredConfirmations(
    entry as unknown as HistoryEntry,
    mintInfo,
    entry.unit ?? 'sat'
  );
  const observedConfirmationProgress = getOnchainConfirmationProgress(
    mempool.summary,
    requiredConfirmations
  );
  const onchainConfirmationProgress = useMemo(
    () =>
      observedConfirmationProgress ??
      (isPaid
        ? buildSatisfiedOnchainConfirmationProgress(requiredConfirmations)
        : buildOnchainRequiredConfirmationProgress(requiredConfirmations)),
    [isPaid, observedConfirmationProgress, requiredConfirmations]
  );
  const paymentInfoValue =
    getMintQuotePaymentValue(entry as unknown as HistoryEntry) ?? entry.paymentRequest;

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
    <Screen name="OnchainReceiveScreen" contentPadding={0} footer={bottomButtons}>
      <View testID={`mint-quote-id-${entry.id}`}>
        <VStack gap={12}>
          <HistoryEntryHeader
            historyEntry={entry as unknown as HistoryEntry}
            showRecipientAvatar={false}
          />
          {!isPaid && (
            <PaymentInfo
              data={[{ name: 'Onchain Payment', value: paymentInfoValue }]}
              unit={entry.unit}
              copyTarget="address"
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
            <HistoryEntryRefresh
              mintInfo={mintInfo}
              historyEntry={entry as unknown as HistoryEntry}
            />
          ) : null}

          {entry.metadata?.memo && <Card message={entry.metadata.memo} variant="info" />}

          <HistoryEntryTimeline
            historyEntry={entry as unknown as HistoryEntry}
            onchainConfirmationProgress={onchainConfirmationProgress}
          />

          <DetailsSection
            items={[
              entry.id && { title: 'ID', value: entry.id },
              source && { title: 'Source', value: source },
              bip321.isBip321 && { title: 'Format', value: 'BIP 321' },
              bip321.optionKinds && {
                title: 'Payment Methods',
                value: <Bip321MethodIcons optionKinds={bip321.optionKinds} usedKind="onchain" />,
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
                title: 'Network Fee',
                value: 'Paid by sender',
              },
              onchainAddress && {
                title: 'Address',
                value: truncateMiddle(onchainAddress, 10),
              },
            ].flatMap((item) => (item ? [item] : []))}
          />
        </VStack>
      </View>
    </Screen>
  );
}
