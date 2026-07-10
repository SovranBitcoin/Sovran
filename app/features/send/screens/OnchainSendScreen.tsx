/**
 * @fileoverview Onchain send (NUT-30 melt) detail screen.
 *
 * The underlying Cashu operation is an onchain melt: the mint takes the ecash,
 * then either broadcasts an on-chain payment or settles it off-chain. The
 * timeline runs "Sending" (submitting to the mint; completes as "Sent") → the
 * bitcoin network phase ("Broadcasting…" → "In mempool · N/6 blocks", a
 * segmented ring fed by the tx's live mempool.space confirmations) →
 * "Confirmed", with a deep link once an outpoint is known. If the mint settles
 * off-chain (PAID, no outpoint) the network phase collapses to a single
 * "Settled off-chain" row; that verdict persists as an annotation so reopening
 * the detail is instant.
 */

import React, { useCallback, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import opacity from 'hex-color-opacity';

import type { HistoryEntry, MeltHistoryEntry } from '@cashu/coco-core';
import {
  buildOnchainConfirmationProgressFromTx,
  parseOutpoint,
  transactionExplorerUrlForTxid,
  type ChainOnchainConfirmationProgress,
} from 'wallet';
import {
  useColadaTransactionAnnotation,
  usePaymentFlowMachine,
  useScreenActions,
} from 'wallet/react';

import {
  AccelerateSection,
  Bip321MethodIcons,
  HistoryEntryTimeline,
  TransactionDetailShell,
  useBip321Info,
} from '@/features/transactions';
import {
  canOnchainMeltQuoteExpire,
  getOnchainMeltAddress,
  getOnchainMeltRequiredConfirmations,
  isOnchainMeltSettled,
  resolveOnchainMeltFeeDisplay,
  resolveOnchainMeltTimelineState,
} from '@/shared/lib/cashu/onchainMelt';
import {
  buildOnchainRequiredConfirmationProgress,
  buildSatisfiedOnchainConfirmationProgress,
} from '@/shared/lib/cashu/onchainMint';
import { useMempoolAcceleration } from '@/shared/hooks/useMempoolAcceleration';
import { useMempoolTxConfirmations } from '@/shared/hooks/useMempoolTxConfirmations';
import { useMintInfo } from '@/shared/hooks/useMintInfo';
import { useOnchainMeltOutpointDiscovery } from '@/shared/hooks/useOnchainMeltOutpointDiscovery';
import { useOnchainMeltQuote } from '@/shared/hooks/useOnchainMeltQuote';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { staticPopup } from '@/shared/lib/popup';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
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

  const requiredConfirmations = getOnchainMeltRequiredConfirmations(mintInfo, entry?.unit ?? 'sat');
  // Canonical quote = source of truth for the outpoint + mint state + address
  // (a persisted, metadata-less entry carries none of these). The annotation is
  // the durable fallback: once a send settles, the outpoint + fee + off-chain
  // verdict are persisted there so this detail keeps its explorer link, fee
  // line, and instant "Settled off-chain" after the mint stops serving the
  // quote row. Annotation-first: the persisted verdict short-circuits the
  // hook's live re-derivation entirely.
  const annotation = useColadaTransactionAnnotation(entry);
  const quote = useOnchainMeltQuote(mintUrl, entry?.quoteId, {
    persistedOnchainMelt: annotation.onchainMelt,
    // The coco op state, NOT the resolved timeline state — a quote flipping
    // PAID live must keep the full 2-read debounce.
    entrySettledAtMount: isOnchainMeltSettled(entry?.state as string | undefined),
  });
  const outpoint = parseOutpoint(quote.outpoint ?? annotation.onchainMelt?.outpoint ?? null);
  // A heuristic match is useful for progress/explorer visibility, but it is
  // not authoritative enough to spend money accelerating: Esplora does not
  // expose first-seen time for unconfirmed transactions, so an older exact
  // address+amount match can survive in the mempool. A live mint outpoint
  // immediately upgrades the match even before the annotation write lands.
  const outpointIsHeuristic =
    !quote.outpoint && annotation.onchainMelt?.outpointSource === 'heuristic';
  const txStatus = useMempoolTxConfirmations(outpoint?.txid ?? null, { requiredConfirmations });
  // Internal settlement: the mint reports the melt PAID but gives no outpoint —
  // it paid off-chain, so there is no on-chain transaction. `offchainSettled`
  // is debounced upstream (two consecutive PAID-no-outpoint reads, sticky
  // once any outpoint was seen) so PAID landing one poll before the outpoint
  // can't flash "Settled off-chain"; the annotation-persisted outpoint keeps
  // it impossible across remounts too.
  const settledInternally = quote.offchainSettled && !outpoint;
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
  // While the mint is PENDING and withholds the outpoint (cdk-bdk publishes
  // it only after confirmation), find the tx ourselves: destination address +
  // exact amount, adopted only on a unique match; confirmed candidates must
  // also postdate the quote.
  const discoveryAddress =
    getOnchainMeltAddress(entry) ?? annotation.onchainMelt?.address ?? quote.request;
  const discoveryAmountSats =
    annotation.onchainMelt?.amountSats ??
    (entry?.unit === 'sat' ? amountToNumber(entry.amount) : null);
  useOnchainMeltOutpointDiscovery({
    quoteId: entry?.quoteId,
    address: discoveryAddress,
    amountSats: discoveryAmountSats,
    quoteCreatedAtSec: entry ? Math.floor(entry.createdAt.valueOf() / 1000) : null,
    enabled: meltState === 'PENDING' && !outpoint && !settledInternally,
  });
  // mempool.space Accelerator: offered while the broadcast tx sits
  // unconfirmed. Paying the acceleration invoice rides the app's normal
  // lightning send flow (machine.scan), which also owns the
  // insufficient-balance errors.
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });
  const acceleration = useMempoolAcceleration({
    txid: outpoint?.txid ?? null,
    quoteId: entry?.quoteId,
    alreadyAccelerated: annotation.onchainMelt?.accelerated === true,
    enabled:
      !!outpoint &&
      meltState === 'PENDING' &&
      !settledInternally &&
      !outpointIsHeuristic &&
      !txStatus.unsupportedNetwork &&
      txStatus.status?.confirmed !== true,
  });
  const handleAccelerate = useCallback(async () => {
    const bolt11 = await acceleration.requestInvoice();
    if (!bolt11) {
      staticPopup('general-error', { text: 'Could not create the acceleration invoice.' });
      return;
    }
    void machine.scan?.(bolt11, { source: 'paste', reset: true });
  }, [acceleration, machine]);

  if (error) {
    log.warn('send.onchain.error', { error });
    return <ScreenErrorState message={error} onGoBack={onCancel} />;
  }
  if (!entry) {
    return <ScreenLoadingState message="Loading transaction..." />;
  }

  const anyLoading = actions.pay.loading || actions.cancel.loading;
  const onchainAddress = discoveryAddress;
  // Settled cost when coco reported one, else the selected option's reserve
  // labeled as a maximum — NUT-30 lets the mint keep the full reserve.
  const feeDisplay = resolveOnchainMeltFeeDisplay(annotation.onchainMelt, quote.feeOptions);
  // The explorer link is mempool.space (mainnet); suppress it where it could
  // only 404.
  const explorerLinkUrl =
    outpoint && !txStatus.unsupportedNetwork ? transactionExplorerUrlForTxid(outpoint.txid) : null;

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
            // Only `expiry` is read for melts: it drives the countdown badge
            // while UNPAID and flips the timeline to "Expired" once passed.
            // Gated on the RESOLVED state so a settled/in-flight send never
            // shows a countdown or regresses to "Expired" off a stale expiry.
            // (Prop is typed for bolt11; redesign will retype it.)
            meltQuote={
              quote.expiry != null && canOnchainMeltQuoteExpire(meltState)
                ? ({ expiry: quote.expiry } as unknown as React.ComponentProps<
                    typeof HistoryEntryTimeline
                  >['meltQuote'])
                : undefined
            }
            onchainConfirmationProgress={onchainConfirmationProgress}
            onchainSettledInternally={settledInternally}
          />
          {explorerLinkUrl && (
            <OpenInExplorerLink url={explorerLinkUrl} inferred={outpointIsHeuristic} />
          )}
          <AccelerateSection
            offer={acceleration.offer}
            accelerating={acceleration.accelerating}
            onAccelerate={handleAccelerate}
          />
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
          feeDisplay && {
            title: feeDisplay.title,
            value: formatAmount({ amount: feeDisplay.sats, unit: 'sat' }),
          },
          { title: 'State', value: meltState ?? entry.state },
          annotation.onchainMelt?.accelerated === true && {
            title: 'Accelerated',
            value: 'mempool.space',
          },
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

function OpenInExplorerLink({ url, inferred }: { url: string; inferred?: boolean }) {
  const linkColor = useThemeColor('link');
  const foreground = useThemeColor('foreground');
  const handlePress = useCallback(() => {
    paymentLog.info('send.onchain.explorer.open', { urlLength: url.length, inferred: !!inferred });
    void openExternalUrl(url).mapErr((error) => {
      paymentLog.warn('send.onchain.explorer.open_failed', { reason: error.type });
      return error;
    });
  }, [url, inferred]);
  return (
    <>
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
      {inferred && (
        <Text size={11} color={opacity(foreground, 0.5)} style={styles.explorerCaption}>
          Matched by amount and destination — the mint hasn&apos;t confirmed this is the exact
          transaction.
        </Text>
      )}
    </>
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
  explorerCaption: {
    textAlign: 'center',
    paddingHorizontal: 32,
    paddingBottom: 8,
    marginTop: -2,
  },
});
