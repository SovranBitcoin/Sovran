/**
 * @fileoverview Onchain send (NUT-30 melt) detail screen.
 *
 * The underlying Cashu operation is an onchain melt: the mint takes the ecash,
 * then either broadcasts an on-chain payment or settles it off-chain. The
 * timeline runs "Paid" (ecash spent) → the bitcoin network phase
 * ("Broadcasting…" → "In mempool · N/6 blocks", a segmented ring fed by the
 * tx's live mempool.space confirmations) → "Confirmed", with a deep link once
 * coco surfaces the outpoint. If the mint settles off-chain (PAID, no outpoint)
 * the network phase collapses to a single "Settled off-chain" row.
 */

import React, { useCallback, useMemo } from 'react';
import { StyleSheet } from 'react-native';

import type { HistoryEntry, MeltHistoryEntry } from '@cashu/coco-core';
import {
  buildOnchainConfirmationProgressFromTx,
  parseOutpoint,
  transactionExplorerUrlForTxid,
  type ChainOnchainConfirmationProgress,
} from 'wallet';
import { useScreenActions } from 'wallet/react';

import {
  Bip321MethodIcons,
  HistoryEntryTimeline,
  TransactionDetailShell,
  useBip321Info,
} from '@/features/transactions';
import {
  getOnchainMeltAddress,
  getOnchainMeltRequiredConfirmations,
  isOnchainMeltSettled,
  resolveOnchainMeltTimelineState,
} from '@/shared/lib/cashu/onchainMelt';
import {
  buildOnchainRequiredConfirmationProgress,
  buildSatisfiedOnchainConfirmationProgress,
} from '@/shared/lib/cashu/onchainMint';
import { useMempoolTxConfirmations } from '@/shared/hooks/useMempoolTxConfirmations';
import { useMintInfo } from '@/shared/hooks/useMintInfo';
import { useOnchainMeltQuote } from '@/shared/hooks/useOnchainMeltQuote';
import { formatAmount } from '@/shared/lib/currency';
import { openExternalUrl } from '@/shared/lib/url';
import { log, paymentLog, useLifecycleLogger } from '@/shared/lib/logger';
import { truncateMiddle } from '@/shared/lib/strings';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import Icon from 'assets/icons';

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
  // The mint the melt was processed with — resolves the "Processing with" row's
  // name + icon (without it the row skeletons forever).
  const mintInfo = useMintInfo(mintUrl);

  // Canonical quote = source of truth for the outpoint + mint state + address
  // (a persisted, metadata-less entry carries none of these).
  const quote = useOnchainMeltQuote(mintUrl, entry?.quoteId);
  const outpoint = parseOutpoint(quote.outpoint);
  const txStatus = useMempoolTxConfirmations(outpoint?.txid ?? null);
  // Internal settlement: the mint reports the melt PAID but gives no outpoint —
  // it paid off-chain, so there is no on-chain transaction. Gate on the QUOTE's
  // own PAID state (not entry.state) so state + outpoint come from the same row
  // and the timeline never briefly asserts "internal" before the quote loads.
  const settledInternally = quote.state === 'PAID' && !outpoint;

  const requiredConfirmations = getOnchainMeltRequiredConfirmations(
    undefined,
    entry?.unit ?? 'sat'
  );
  const observedProgress = buildOnchainConfirmationProgressFromTx(
    txStatus.status,
    requiredConfirmations
  );
  // The timeline reads `historyEntry.state`, but two sources advance it and
  // either can lag the other: the polled melt-quote row (fresh once the mint
  // marks it PAID/PENDING) and the live operation entry (finalizes even for an
  // internal, no-broadcast send). Take whichever is further along so a stale
  // `UNPAID` quote row can't pin the timeline at "Paid". See
  // resolveOnchainMeltTimelineState.
  const meltState = resolveOnchainMeltTimelineState(
    quote.state,
    entry?.state as string | undefined
  );
  const isPaid = isOnchainMeltSettled(meltState);
  const hasOnchainTx = !!outpoint;
  const onchainConfirmationProgress = useMemo<ChainOnchainConfirmationProgress>(
    () =>
      observedProgress ??
      // Only claim confirmations when there is an actual broadcast tx to count.
      // A PAID melt with NO outpoint is (or is about to resolve as) an off-chain
      // settle; fabricating a satisfied 6/6 here made the timeline flash
      // "In mempool · N/N → Confirmed" for the window where the entry finalized
      // before the quote row confirmed no-outpoint, then jump to "Settled
      // off-chain". Without an outpoint, hold the neutral in-progress state until
      // the settlement type is known.
      (isPaid && hasOnchainTx
        ? buildSatisfiedOnchainConfirmationProgress(requiredConfirmations)
        : buildOnchainRequiredConfirmationProgress(requiredConfirmations)),
    [observedProgress, isPaid, hasOnchainTx, requiredConfirmations]
  );
  const timelineEntry = useMemo(
    () => (entry ? { ...entry, state: meltState ?? entry.state } : null),
    [entry, meltState]
  );

  if (error) {
    log.warn('send.onchain.error', { error });
    return <ScreenErrorState message={error} onGoBack={onCancel} />;
  }
  if (!entry) {
    return <ScreenLoadingState message="Loading transaction..." />;
  }

  const anyLoading = actions.pay.loading || actions.cancel.loading;
  const onchainAddress = getOnchainMeltAddress(entry) ?? quote.request;
  const explorerLinkUrl = outpoint
    ? transactionExplorerUrlForTxid(outpoint.txid)
    : null;

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
              // Only after settlement; before that, Pay / Cancel apply.
              condition: isPaid,
            },
            {
              testID: 'onchain-send-pay',
              text: actions.pay.loading ? 'Sending...' : 'Pay',
              icon: actions.pay.loading ? 'ri:loader-line' : 'ri:send-plane-2-fill',
              variant: 'primary',
              onPress: () => actions.pay.execute(),
              condition: actions.pay.available,
              disabled: anyLoading,
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
    <TransactionDetailShell
      screenName="OnchainSendScreen"
      testID={`onchain-send-id-${entry.id}`}
      entry={entry as unknown as HistoryEntry}
      mintInfo={mintInfo}
      footer={bottomButtons}
      timeline={
        <>
          <HistoryEntryTimeline
            historyEntry={(timelineEntry ?? entry) as unknown as HistoryEntry}
            onchainConfirmationProgress={onchainConfirmationProgress}
            onchainSettledInternally={settledInternally}
          />
          {explorerLinkUrl && <OpenInExplorerLink url={explorerLinkUrl} />}
        </>
      }>
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
          { title: 'State', value: meltState ?? entry.state },
          entry.quoteId && { title: 'Quote ID', value: truncateMiddle(entry.quoteId, 7) },
          onchainAddress && {
            title: 'Destination',
            value: truncateMiddle(onchainAddress, 12),
          },
          outpoint && { title: 'Transaction', value: truncateMiddle(outpoint.txid, 10) },
          mintUrl && { title: 'Mint', value: truncateMiddle(mintUrl, 12) },
        ].flatMap((item) => (item ? [item] : []))}
      />
    </TransactionDetailShell>
  );
}

function OpenInExplorerLink({ url }: { url: string }) {
  const linkColor = useThemeColor('link');
  const handlePress = useCallback(() => {
    paymentLog.info('send.onchain.explorer.open', { urlLength: url.length });
    void openExternalUrl(url).mapErr((error) => {
      paymentLog.warn('send.onchain.explorer.open_failed', { reason: error.type });
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
    gap: 6,
    paddingVertical: 8,
  },
});
