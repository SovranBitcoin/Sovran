/**
 * @fileoverview Shared Lightning receive screen component
 *
 * Display component for Lightning mint quotes (receiving). Actions (copy, share)
 * are handled by the screen-action system.
 */

import React, { useEffect } from 'react';
import { useWindowDimensions } from 'react-native';

import type { MintHistoryEntry } from '@cashu/coco-core';
import { isMintQuotePaymentObserved } from 'wallet';
import { useScreenActions } from 'wallet/react';
import { paymentLog, useLifecycleLogger } from '@/shared/lib/logger';

import { MintSelector } from '@/features/wallet';
import { formatAmount } from '@/shared/lib/currency';
import { truncateMiddle } from '@/shared/lib/strings';
import {
  HistoryEntryRefresh,
  TransactionDetailShell,
  TransactionLocationSection,
  useBip321Info,
  Bip321MethodIcons,
  useIsTransactionHistoryView,
} from '@/features/transactions';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import type { ButtonHandlerButton } from '@/shared/ui/composed/ButtonHandler';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { Card } from '@/shared/ui/composed/Card';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { CopyableValue } from '@/shared/ui/composed/CopyableValue';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import { useMintInfo } from '@/shared/hooks/useMintInfo';

const QUOTE_CARD_HORIZONTAL_MARGIN = 16;

interface LightningReceiveScreenProps {
  mintHistoryEntry: MintHistoryEntry | string;
  extraButtons?: ButtonHandlerButton[];
  onRequestMintList?: () => void;
}

export function LightningReceiveScreen({
  mintHistoryEntry,
  extraButtons = [],
  onRequestMintList,
}: LightningReceiveScreenProps) {
  useLifecycleLogger('LightningReceiveScreen');
  const { width: windowWidth } = useWindowDimensions();
  const { entry, error, actions, source, mintUrl } = useScreenActions(
    'mintQuote',
    mintHistoryEntry
  );
  const mintInfo = useMintInfo(entry?.mintUrl);
  const bip321 = useBip321Info(entry?.id);

  useEffect(() => {
    if (error) paymentLog.warn('receive.lightning.error', { error });
  }, [error]);

  const isPaid = isMintQuotePaymentObserved(entry);
  // History view (transactions list) → fixed mint, non-clickable "Receiving with".
  const isHistoryView = useIsTransactionHistoryView();
  const quoteCardWidth = Math.max(0, windowWidth - QUOTE_CARD_HORIZONTAL_MARGIN * 2);

  useEffect(() => {
    if (!entry) return;
    paymentLog.debug('receive.lightning.render', {
      state: entry.state,
      isPaid,
      amount: entry.amount,
      unit: entry.unit,
    });
  }, [entry, isPaid]);

  if (error) {
    return (
      <ScreenErrorState
        message={error}
        onGoBack={() => {
          void actions.back.execute();
        }}
      />
    );
  }

  if (!entry) {
    return <ScreenLoadingState message="Loading transaction..." />;
  }

  const bottomButtons = (
    <BottomButtons>
      <HStack justify="center" align="center">
        <ButtonHandler
          buttons={[
            {
              text: isPaid ? 'Close' : 'Cancel',
              icon: 'ri:close-circle-line',
              variant: 'secondary',
              onPress: () => actions.back.execute(),
              condition: actions.back.available,
            },
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
    <TransactionDetailShell
      screenName="LightningReceiveScreen"
      testID={`mint-quote-id-${entry.id}`}
      entry={entry}
      source={source}
      footer={bottomButtons}
      beforeStatus={
        <>
          {!isPaid && (
            <PaymentInfo
              data={[{ name: 'Lightning', value: entry.paymentRequest }]}
              unit={entry.unit}
              copyTarget="lightningInvoice"
            />
          )}
          {isPaid && <TransactionLocationSection transactionId={entry.id} />}
        </>
      }
      statusRow={
        <>
          {!isPaid && !isHistoryView ? (
            <MintSelector
              width={quoteCardWidth}
              unit={entry.unit}
              selectedMintUrl={mintUrl}
              onRequestMintList={onRequestMintList}
            />
          ) : mintInfo ? (
            <HistoryEntryRefresh mintInfo={mintInfo} historyEntry={entry} />
          ) : null}
          {entry.metadata?.memo && <Card message={entry.metadata.memo} variant="info" />}
        </>
      }>
      <DetailsSection
        items={[
          entry.id && { title: 'ID', value: entry.id },
          source && { title: 'Source', value: source },
          bip321.isBip321 && { title: 'Format', value: 'BIP 321' },
          bip321.optionKinds && {
            title: 'Payment Methods',
            value: <Bip321MethodIcons optionKinds={bip321.optionKinds} usedKind="lightning" />,
          },
          { title: 'Date', value: entry.createdAt.datetime },
          {
            title: 'Amount',
            value: formatAmount({ amount: entry.amount, unit: entry.unit }),
          },
          { title: 'State', value: entry.state },
          entry.quoteId && {
            title: 'Quote ID',
            value: (
              <CopyableValue
                value={entry.quoteId}
                display={truncateMiddle(entry.quoteId, 7)}
                copyTarget="quoteId"
              />
            ),
          },
          mintUrl && { title: 'Mint', value: truncateMiddle(mintUrl, 12) },
          {
            title: 'Invoice',
            value: truncateMiddle(entry.paymentRequest, 10),
          },
        ].flatMap((item) => (item ? [item] : []))}
      />
    </TransactionDetailShell>
  );
}
