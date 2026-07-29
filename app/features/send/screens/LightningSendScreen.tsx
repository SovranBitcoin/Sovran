/**
 * @fileoverview Shared Lightning send screen component
 *
 * Display component for Lightning melt quotes (sending). Supports two phases:
 * - Preview (quoteId='') — synthetic entry, "Pay" runs prepare+execute
 * - Ready (quoteId set) — real entry from history, "Pay" runs execute only
 * - Done (state='PAID') — "Close" button
 *
 * Actions (pay, cancel) are handled by the screen-action system.
 * The navigateToMeltPreview handler navigates here instantly with a synthetic
 * entry; the pay action handles LNURL resolution + prepareMeltBolt11 + executeMelt.
 */

import React, { useEffect } from 'react';
import { useWindowDimensions } from 'react-native';

import { Stack } from 'expo-router';

import type { MeltHistoryEntry } from '@cashu/coco-core';
import { isMeltQuotePaid, isMeltQuoteReadyToPay } from 'wallet';
import { useScreenActions } from 'wallet/react';
import { MintSelector } from '@/features/wallet';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
import {
  HistoryEntryRefresh,
  TransactionDetailShell,
  TransactionLocationSection,
  useBip321Info,
  Bip321MethodIcons,
  useIsTransactionHistoryView,
} from '@/features/transactions';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { CopyableValue } from '@/shared/ui/composed/CopyableValue';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { formatAmount } from '@/shared/lib/currency';
import { truncateMiddle } from '@/shared/lib/strings';
import { useMintInfo } from '@/shared/hooks/useMintInfo';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { resolveIdentityName } from '@/shared/lib/identity';
import { setTransactionAnnotation } from '@/shared/stores/profile/transactionAnnotationStore';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';
import { consumePendingZap, peekPendingZap } from '@/shared/stores/runtime/pendingZapStore';
import { ZappedPostSection } from '@/features/transactions/components/detail/ZappedPostSection';
import { RecipientHeader } from '../components/RecipientHeader';
import { MeltDestinationFingerprintProbe } from '../components/MeltDestinationFingerprintProbe';
import { MeltSelectedMintProbe } from '../components/MeltSelectedMintProbe';

const QUOTE_CARD_HORIZONTAL_MARGIN = 16;

interface LightningSendScreenProps {
  meltHistoryEntry?: MeltHistoryEntry | string;
  onCancel: () => void;
  onRequestMintList?: () => void;
}

export function LightningSendScreen({
  meltHistoryEntry,
  onCancel,
  onRequestMintList,
}: LightningSendScreenProps) {
  useLifecycleLogger('LightningSendScreen');
  const { width: windowWidth } = useWindowDimensions();
  const { entry, error, actions, source, mintUrl } = useScreenActions(
    'meltQuote',
    meltHistoryEntry
  );
  const mintInfo = useMintInfo(entry?.mintUrl);
  const bip321 = useBip321Info(entry?.id);
  // History view (transactions list) → fixed mint, non-clickable "Sent with".
  const isHistoryView = useIsTransactionHistoryView();

  // Recipient identity for the navigation header. The machine threads both
  // pubkey (NIP-05) and profile (kind-0) through `entry.metadata` via
  // AmountFlowScreen → `actions.next.execute(...)` → `machine.enterAmount`
  // → `sovranPaymentConfig.navigateToMeltPreview`. The profile is flattened
  // into individual string keys at write time (`MeltHistoryEntry.metadata`
  // is typed `Record<string, string>` upstream), so the read-side picks
  // `recipientDisplayName` / `recipientAvatarUrl` directly.
  //
  // `useNostrProfileMetadata(pubkey)` is kept as a single warm-cache
  // fallback for the race-loss case where the entry has `recipientPubkey`
  // but `recipientDisplayName` wasn't populated yet at the moment of
  // navigation. On a warm cache it returns synchronously on first render
  // — no flicker; on a cold cache the layout default "Send Lightning"
  // stays visible until kind-0 lands (documented trade-off).
  const recipientPubkey =
    typeof entry?.metadata?.recipientPubkey === 'string'
      ? entry.metadata.recipientPubkey
      : undefined;
  const entryDisplayName =
    typeof entry?.metadata?.recipientDisplayName === 'string'
      ? entry.metadata.recipientDisplayName
      : null;
  const entryAvatarUrl =
    typeof entry?.metadata?.recipientAvatarUrl === 'string'
      ? entry.metadata.recipientAvatarUrl
      : null;
  log.debug('send.melt_quote.recipient_metadata', {
    metadataKeys: entry?.metadata ? Object.keys(entry.metadata as Record<string, unknown>) : null,
    recipientPubkeyPresent: !!recipientPubkey,
    entryDisplayName,
    entryAvatarUrlPresent: !!entryAvatarUrl,
  });
  const { metadata: liveNostrMetadata } = useNostrProfileMetadata(recipientPubkey);
  const fallbackDisplayName = liveNostrMetadata
    ? resolveIdentityName({ pubkey: recipientPubkey ?? '', nostrProfile: liveNostrMetadata })
    : null;
  const headerDisplayName = entryDisplayName ?? fallbackDisplayName ?? null;
  const headerAvatarUrl = entryAvatarUrl ?? liveNostrMetadata?.picture ?? null;

  // Persist the recipient's nostr identity as a counterparty annotation keyed to
  // the melt's quoteId, so the transactions row + detail show their avatar. The
  // preview metadata (recipientPubkey/...) is transient; only the annotation
  // survives onto the persisted melt row. Fires once quoteId is non-empty.
  const recipientNip05 =
    typeof entry?.metadata?.recipientNip05 === 'string' ? entry.metadata.recipientNip05 : undefined;
  useEffect(() => {
    const quoteId = entry?.quoteId;
    if (!quoteId || !recipientPubkey) return;
    setTransactionAnnotation(`quote:${quoteId}`, {
      counterparty: {
        pubkey: recipientPubkey,
        direction: 'recipient',
        ...(headerDisplayName ? { displayName: headerDisplayName } : {}),
        ...(headerAvatarUrl ? { avatarUrl: headerAvatarUrl } : {}),
        ...(recipientNip05 ? { nip05: recipientNip05 } : {}),
      },
    });
  }, [entry?.quoteId, recipientPubkey, headerDisplayName, headerAvatarUrl, recipientNip05]);

  // Zap (preset or custom): if this melt was launched from a post's zap menu,
  // the pending-zap registry holds the post context keyed by meltTarget.
  // Persist it as a zap annotation once the real quoteId exists (same window
  // as the counterparty annotation above). `entry?.state` is in the deps
  // because `receiptKind` is stamped by the LNURL extras callback DURING pay
  // — the post-pay re-run upgrades a 'plain' write to 'nip57' — and because
  // the paid re-run records the durable zapped highlight + count bump, after
  // which the pending zap is consumed (making later re-runs no-ops). Accepted
  // edge: dismissing the screen mid-pay before the paid state renders skips
  // the durable mark; the annotation is already written and counts self-heal
  // via nagg's 9735 aggregation.
  const meltTarget =
    typeof entry?.metadata?.meltTarget === 'string' ? entry.metadata.meltTarget : undefined;
  useEffect(() => {
    const quoteId = entry?.quoteId;
    if (!quoteId || !meltTarget || !entry) return;
    const pending = peekPendingZap(meltTarget);
    if (!pending) return;
    setTransactionAnnotation(`quote:${quoteId}`, {
      zap: {
        eventId: pending.eventId,
        eventKind: pending.eventKind,
        authorPubkey: pending.authorPubkey,
        ...(pending.authorName ? { authorName: pending.authorName } : {}),
        ...(pending.authorAvatarUrl ? { authorAvatarUrl: pending.authorAvatarUrl } : {}),
        contentPreview: pending.contentPreview,
        emoji: pending.emoji,
        ...(pending.comment ? { comment: pending.comment } : {}),
        receiptKind: pending.receiptKind ?? 'plain',
      },
    });
    if (isMeltQuotePaid(entry)) {
      // Sats are only attributable when the melt is sat-denominated; a
      // fiat-unit custom melt records the highlight alone (sats 0) and the
      // public count self-heals from the receipt aggregate.
      const paidSats = entry.unit === 'sat' ? Number(entry.amount) : (pending.presetSats ?? 0);
      useNostrSocialStore
        .getState()
        .recordZapPaid(pending.eventId, Number.isFinite(paidSats) ? paidSats : 0, pending.baseSats);
      consumePendingZap(meltTarget);
    }
  }, [entry, meltTarget]);

  if (error) {
    log.warn('send.lightning.error', { error });
    return <ScreenErrorState message={error} onGoBack={onCancel} />;
  }

  if (!entry) {
    return <ScreenLoadingState message="Loading transaction..." />;
  }

  const isPreview = !entry.quoteId;
  const anyLoading = actions.pay.loading || actions.cancel.loading;
  const quoteCardWidth = Math.max(0, windowWidth - QUOTE_CARD_HORIZONTAL_MARGIN * 2);
  const isPaid = isMeltQuotePaid(entry);
  const isReadyToPay = isMeltQuoteReadyToPay(entry);
  log.debug('send.lightning.render', {
    state: entry.state,
    isPreview,
    amount: entry.amount,
    unit: entry.unit,
  });

  const bottomButtons = (
    <BottomButtons>
      <HStack justify="center" align="center">
        <ButtonHandler
          buttons={[
            {
              testID: 'melt-close',
              text: 'Close',
              icon: 'ri:close-circle-line',
              variant: 'secondary',
              onPress: async () => onCancel(),
              condition: isPaid,
            },
            {
              testID: 'melt-pay',
              text: actions.pay.loading ? 'Sending...' : 'Pay',
              icon: actions.pay.loading ? 'ri:loader-line' : 'ri:send-plane-2-fill',
              variant: 'primary',
              onPress: () => actions.pay.execute(),
              condition: actions.pay.available,
              disabled: anyLoading,
            },
            {
              testID: 'melt-cancel',
              text: actions.cancel.loading ? 'Cancelling...' : 'Cancel',
              icon: actions.cancel.loading ? 'ri:loader-line' : 'ri:close-circle-line',
              variant: 'secondary',
              onPress: async () => {
                // A synthetic preview has no operation or quote to roll back;
                // Cancel simply leaves it. Prepared quotes still release their
                // reserved proofs before navigation.
                if (!isPreview) await actions.cancel.execute();
                onCancel();
              },
              // Hidden while the pay is in flight — a disabled X mid-payment
              // reads as a broken button. Synthetic previews remain directly
              // dismissible even though the rollback action is unavailable.
              condition: (isPreview || actions.cancel.available) && !actions.pay.loading,
              disabled: anyLoading,
            },
          ]}
        />
      </HStack>
    </BottomButtons>
  );

  return (
    <TransactionDetailShell
      screenName="LightningSendScreen"
      testID={`melt-quote-id-${entry.id}`}
      entry={entry}
      source={source}
      footer={bottomButtons}
      headerOverride={
        recipientPubkey && headerDisplayName ? (
          // Override the layout's static "Send Lightning" title with the
          // resolved recipient identity. Expo Router lets a screen body
          // render `<Stack.Screen options={...} />` to update its own
          // active-route options without re-declaring at the layout level.
          // See `AmountFlowScreen.tsx` for the same pattern.
          <Stack.Screen
            options={{
              headerTitle: () => (
                <RecipientHeader
                  pubkey={recipientPubkey}
                  displayName={headerDisplayName}
                  avatarUrl={headerAvatarUrl}
                />
              ),
            }}
          />
        ) : null
      }
      beforeStatus={
        <>
          <MeltSelectedMintProbe mintUrl={entry.mintUrl} transactionId={entry.id} />
          {entry.metadata?.meltTarget ? (
            <MeltDestinationFingerprintProbe destination={entry.metadata.meltTarget} />
          ) : null}
          <ZappedPostSection entry={entry} />
          {isPaid ? <TransactionLocationSection transactionId={entry.id} /> : null}
        </>
      }
      statusRow={
        isReadyToPay && !isHistoryView ? (
          <MintSelector
            testID="melt-mint-selector"
            width={quoteCardWidth}
            unit={entry.unit}
            selectedMintUrl={mintUrl}
            onRequestMintList={onRequestMintList}
          />
        ) : mintInfo ? (
          <HistoryEntryRefresh mintInfo={mintInfo} historyEntry={entry} />
        ) : null
      }>
      <DetailsSection
        items={[
          source && { title: 'Source', value: source },
          bip321.isBip321 && { title: 'Format', value: 'BIP 321' },
          bip321.optionKinds && {
            title: 'Payment Methods',
            value: <Bip321MethodIcons optionKinds={bip321.optionKinds} usedKind="lightning" />,
          },
          { title: 'Date', value: entry.createdAt.datetime },
          { title: 'Amount', value: formatAmount({ amount: entry.amount, unit: entry.unit }) },
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
          entry.metadata?.meltTarget && {
            title: 'Destination',
            value: truncateMiddle(entry.metadata.meltTarget, 12),
          },
          mintUrl && { title: 'Mint', value: truncateMiddle(mintUrl, 12) },
        ].flatMap((item) => (item ? [item] : []))}
      />
    </TransactionDetailShell>
  );
}
