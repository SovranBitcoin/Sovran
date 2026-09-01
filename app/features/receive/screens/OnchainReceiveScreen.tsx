import { useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';

import type { MintInfo } from '@cashu/cashu-ts';
import type { MintHistoryEntry } from '@cashu/coco-core';
import { getOnchainConfirmationProgress, isMintQuotePaymentObserved } from 'wallet';
import type { DecoratedEntryFields } from 'wallet';
import type { BoundAction } from 'wallet/react';

import { MintSelector } from '@/features/wallet';
import {
  transactionLeadDetailItems,
  HistoryEntryRefresh,
  HistoryEntryTimeline,
  TransactionDetailShell,
  TransactionLocationSection,
  useBip321Info,
  useIsTransactionHistoryView,
  amountDetailItem,
  stateDetailItem,
  mintDetailItem,
} from '@/features/transactions';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { useMempoolAddressSummary } from '@/shared/hooks/useMempoolAddressSummary';
import {
  buildOnchainRequiredConfirmationProgress,
  buildSatisfiedOnchainConfirmationProgress,
  getMintQuotePaymentValue,
  getOnchainMintAddress,
  getOnchainMintQuoteRequiredConfirmations,
} from '@/shared/lib/cashu/onchainMint';
import { asHistoryEntry } from '@/shared/lib/cashu/syntheticHistory';
import { paymentLog, useLifecycleLogger } from '@/shared/lib/logger';
import { openExternalUrl } from '@/shared/lib/url';
import { truncateMiddle } from '@/shared/lib/strings';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import Icon from 'assets/icons';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import type { ButtonHandlerButton } from '@/shared/ui/composed/ButtonHandler';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { Card } from '@/shared/ui/composed/Card';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { HStack } from '@/shared/ui/primitives/View/HStack';

const QUOTE_CARD_HORIZONTAL_MARGIN = 16;

export type OnchainReceiveEntry = MintHistoryEntry & DecoratedEntryFields;

interface OnchainReceiveScreenProps {
  entry: OnchainReceiveEntry;
  actions: Record<'copy' | 'share' | 'back', BoundAction>;
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
  const historyEntry = asHistoryEntry(entry);
  const onchainAddress = getOnchainMintAddress(historyEntry);
  const mempool = useMempoolAddressSummary(onchainAddress);
  const bip321 = useBip321Info(entry.id);
  const isPaid = isMintQuotePaymentObserved(entry);
  // Opened from the transactions (history) list, not the live receive flow —
  // the mint is fixed, so show the non-clickable "Receiving with" row.
  const isHistoryView = useIsTransactionHistoryView();
  const quoteCardWidth = Math.max(0, windowWidth - QUOTE_CARD_HORIZONTAL_MARGIN * 2);
  const requiredConfirmations = getOnchainMintQuoteRequiredConfirmations(
    historyEntry,
    mintInfo,
    entry.unit ?? 'sat'
  );
  const observedConfirmationProgress = getOnchainConfirmationProgress(
    mempool.summary,
    requiredConfirmations
  );
  // KEPT as a manual memo — identity contract, not an optimization. React
  // Compiler will not preserve it (`observedConfirmationProgress` is a fresh
  // object whenever the helper has a summary to report, so it cannot prove the
  // dependency stable) and this screen therefore stays on the bailout list.
  // Dropping the memo is worse: on the null path the fallback would allocate
  // every render, re-running the logging effect below and invalidating the
  // whole timeline model in TimelineCard.
  // ast-grep-ignore: no-manual-memo-tsx
  const onchainConfirmationProgress = useMemo(
    () =>
      observedConfirmationProgress ??
      (isPaid
        ? buildSatisfiedOnchainConfirmationProgress(requiredConfirmations)
        : buildOnchainRequiredConfirmationProgress(requiredConfirmations)),
    [isPaid, observedConfirmationProgress, requiredConfirmations]
  );
  const paymentInfoValue = getMintQuotePaymentValue(historyEntry) ?? entry.paymentRequest;
  // Once the deposit is visible on our own explorer, offer a deep link to the
  // funding transaction (falling back to the address page) so the user can
  // watch confirmations at the source. Gated on an observed payment so the link
  // only appears alongside the on-chain confirmation status.
  const explorerLinkUrl = observedConfirmationProgress
    ? (mempool.summary?.transactionExplorerUrl ?? mempool.summary?.explorerUrl ?? null)
    : null;

  useEffect(() => {
    paymentLog.debug('receive.onchain.screen.render', {
      state: entry.state,
      amount: entry.amount,
      unit: entry.unit,
      isPaid,
      source,
      hasMintUrl: !!mintUrl,
      hasMintInfo: !!mintInfo,
      hasOnchainAddress: !!onchainAddress,
      onchainAddressLength: onchainAddress?.length ?? 0,
      paymentInfoLength: paymentInfoValue?.length ?? 0,
      requiredConfirmations,
      hasObservedConfirmationProgress: !!observedConfirmationProgress,
      confirmationCurrent: onchainConfirmationProgress.currentConfirmations,
      confirmationRequired: onchainConfirmationProgress.requiredConfirmations,
      bip321: bip321.isBip321,
      optionKindCount: bip321.optionKinds?.length ?? 0,
      extraButtonCount: extraButtons.length,
      actionNames: Object.keys(actions),
    });
  }, [
    actions,
    bip321.isBip321,
    bip321.optionKinds?.length,
    entry,
    extraButtons.length,
    isPaid,
    mintInfo,
    mintUrl,
    observedConfirmationProgress,
    onchainAddress,
    onchainConfirmationProgress,
    paymentInfoValue,
    requiredConfirmations,
    source,
  ]);

  const bottomButtons = (
    <BottomButtons>
      <HStack justify="center" align="center">
        <ButtonHandler
          buttons={[
            {
              text: isPaid ? 'Close' : 'Cancel',
              icon: 'ri:close-circle-line',
              variant: 'secondary',
              onPress: () => {
                paymentLog.info('receive.onchain.action.press', {
                  action: 'back',
                  state: entry.state,
                  isPaid,
                });
                return actions.back.execute();
              },
              condition: actions.back.available,
            },
            {
              text: 'Copy',
              icon: 'lets-icons:copy',
              variant: 'primary',
              onPress: () => {
                paymentLog.info('receive.onchain.action.press', {
                  action: 'copy',
                  state: entry.state,
                  isPaid,
                  hasOnchainAddress: !!onchainAddress,
                });
                return actions.copy.execute();
              },
              condition: actions.copy.available,
            },
            {
              text: 'Share',
              icon: 'ri:share-fill',
              variant: 'secondary',
              onPress: () => {
                paymentLog.info('receive.onchain.action.press', {
                  action: 'share',
                  state: entry.state,
                  isPaid,
                  hasPaymentInfo: !!paymentInfoValue,
                });
                return actions.share.execute();
              },
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
      screenName="OnchainReceiveScreen"
      testID={`mint-quote-id-${entry.id}`}
      entry={historyEntry}
      source={source}
      footer={bottomButtons}
      beforeStatus={
        <>
          {!isPaid && (
            <PaymentInfo
              data={[{ name: 'Onchain Payment', value: paymentInfoValue }]}
              unit={entry.unit}
              copyTarget="address"
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
            <HistoryEntryRefresh mintInfo={mintInfo} historyEntry={historyEntry} />
          ) : null}
          {entry.metadata?.memo && <Card message={entry.metadata.memo} variant="info" />}
        </>
      }
      timeline={
        <>
          <HistoryEntryTimeline
            historyEntry={historyEntry}
            onchainConfirmationProgress={onchainConfirmationProgress}
          />
          {explorerLinkUrl && <OpenInExplorerLink url={explorerLinkUrl} />}
        </>
      }>
      <DetailsSection
        items={[
          entry.id && { title: 'ID', value: entry.id },
          ...transactionLeadDetailItems({
            source,
            bip321,
            usedKind: 'onchain',
            createdAt: entry.createdAt.datetime,
          }),
          amountDetailItem({ amount: entry.amount, unit: entry.unit }),
          stateDetailItem(entry.state),
          entry.quoteId && { title: 'Quote ID', value: truncateMiddle(entry.quoteId, 7) },
          mintDetailItem(mintUrl),
          {
            title: 'Network Fee',
            value: 'Paid by sender',
          },
          onchainAddress && {
            title: 'Address',
            value: truncateMiddle(onchainAddress, 10),
          },
        ]}
      />
    </TransactionDetailShell>
  );
}

function OpenInExplorerLink({ url }: { url: string }) {
  const linkColor = useThemeColor('link');
  const handlePress = useCallback(() => {
    paymentLog.info('receive.onchain.explorer.open', { urlLength: url.length });
    void openExternalUrl(url).mapErr((error) => {
      paymentLog.warn('receive.onchain.explorer.open_failed', { reason: error.type });
      return error;
    });
  }, [url]);
  return (
    <Pressable
      haptics
      accessibilityRole="link"
      accessibilityLabel="Open in explorer"
      onPress={handlePress}
      style={styles.explorerLink}>
      <Text size={13} color={linkColor}>
        Open in explorer
      </Text>
      <Icon name="lucide:arrow-up-right" size={14} color={linkColor} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  explorerLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
  },
});
