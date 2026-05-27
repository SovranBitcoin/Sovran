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

import React from 'react';
import { useWindowDimensions, View } from 'react-native';

import { Stack } from 'expo-router';

import type { MeltHistoryEntry } from '@cashu/coco-core';
import { isMeltQuotePaid, isMeltQuoteReadyToPay } from 'colada';
import { useScreenActions } from 'colada/react';
import { MintSelector } from '@/features/wallet';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
import {
  HistoryEntryHeader,
  HistoryEntryRefresh,
  HistoryEntryTimeline,
  TransactionLocationSection,
  useBip321Info,
  Bip321MethodIcons,
} from '@/features/transactions';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import { Screen } from '@/shared/ui/composed/Screen';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { formatAmount } from '@/shared/lib/currency';
import { truncateMiddle } from '@/shared/lib/strings';
import { useMintInfo } from '@/shared/hooks/useMintInfo';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { resolveIdentityName } from '@/shared/lib/identity';
import { RecipientHeader } from '../components/RecipientHeader';

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
    <Screen name="LightningSendScreen" contentPadding={0} footer={bottomButtons}>
      {recipientPubkey && headerDisplayName ? (
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
      ) : null}
      <View testID={`melt-quote-id-${entry.id}`}>
        <VStack gap={12}>
          <HistoryEntryHeader historyEntry={entry} showRecipientAvatar={false} />

          {isPaid && <TransactionLocationSection transactionId={entry.id} />}

          {isReadyToPay ? (
            <MintSelector
              width={quoteCardWidth}
              unit={entry.unit}
              selectedMintUrl={mintUrl}
              onRequestMintList={onRequestMintList}
            />
          ) : mintInfo ? (
            <HistoryEntryRefresh mintInfo={mintInfo} historyEntry={entry} />
          ) : null}

          <HistoryEntryTimeline historyEntry={entry} />

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
              entry.quoteId && { title: 'Quote ID', value: truncateMiddle(entry.quoteId, 7) },
              entry.metadata?.meltTarget && {
                title: 'Destination',
                value: truncateMiddle(entry.metadata.meltTarget, 12),
              },
              mintUrl && { title: 'Mint', value: truncateMiddle(mintUrl, 12) },
            ].flatMap((item) => (item ? [item] : []))}
          />
        </VStack>
      </View>
    </Screen>
  );
}
