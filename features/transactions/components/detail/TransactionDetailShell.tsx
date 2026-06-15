import React from 'react';

import { getCounterparty } from '@sovranbitcoin/colada';

import { Screen } from '@/shared/ui/composed/Screen';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HistoryEntryHeader } from '@/features/transactions/components/detail/HistoryEntryHeader';
import { HistoryEntryRefresh } from '@/features/transactions/components/detail/HistoryEntryRefresh';
import { HistoryEntryTimeline } from '@/features/transactions/components/detail/HistoryEntryTimeline';
import { CounterpartyTransactions } from '@/features/transactions/components/CounterpartyTransactions';

type DetailEntry = React.ComponentProps<typeof HistoryEntryTimeline>['historyEntry'];
type MintInfo = React.ComponentProps<typeof HistoryEntryRefresh>['mintInfo'];

interface TransactionDetailShellProps {
  /** Screen telemetry/name. */
  screenName: string;
  /** Stable per-entry testID (e.g. `send-token-id-${entry.id}`). */
  testID: string;
  /**
   * The decorated history entry; fed to the default header/refresh/timeline.
   * Optional: composite views (e.g. a swap group, which isn't a single coco
   * entry) omit it and supply their own header/body via the slots below.
   */
  entry?: DetailEntry;
  /** Mint info for the refresh row. */
  mintInfo?: MintInfo;
  /** Whether the header shows the recipient avatar (sends with a recipient). */
  showRecipientAvatar?: boolean;
  /** Footer (bottom buttons). */
  footer: React.ReactNode;
  /**
   * Screen-level sibling rendered before the body — e.g. a `<Stack.Screen
   * options>` route-header override. Renders nothing visually.
   */
  headerOverride?: React.ReactNode;
  /**
   * Screen-specific content rendered between the header and the status/refresh
   * row — warnings, the bearer-token PaymentInfo, memo cards, the redeemed
   * location section, etc. Each screen controls its own gating.
   */
  beforeStatus?: React.ReactNode;
  /**
   * Overrides the default status row (HistoryEntryRefresh). Quote screens swap
   * in a MintSelector while unpaid; when omitted the refresh row is rendered.
   */
  statusRow?: React.ReactNode;
  /**
   * Overrides the default timeline (HistoryEntryTimeline). Use when a screen
   * needs extra timeline props (e.g. onchain confirmation progress); when
   * omitted the standard timeline is rendered.
   */
  timeline?: React.ReactNode;
  /**
   * Screen-specific content rendered after the timeline — typically the
   * DetailsSection and any trailing widgets.
   */
  children: React.ReactNode;
}

/**
 * Shared scaffold for transaction detail screens (Receive/Send/Lightning/
 * Onchain/PaymentRequest). Owns the Screen wrapper, entry-id marker, and the
 * header → [beforeStatus] → refresh → timeline → [children] spine so each
 * screen only supplies its variable pieces (warnings, details, buttons).
 *
 * Loading/error states stay in the screens because their recovery actions
 * differ; the shell assumes a resolved `entry` when one is supplied. When
 * `entry` is omitted, the entry-driven header/refresh/timeline are skipped and
 * the screen drives the whole body through `beforeStatus`/`statusRow`/
 * `timeline`/`children` (used by the swap-group detail view).
 */
export function TransactionDetailShell({
  screenName,
  testID,
  entry,
  mintInfo,
  showRecipientAvatar = false,
  footer,
  headerOverride,
  beforeStatus,
  statusRow,
  timeline,
  children,
}: TransactionDetailShellProps): React.ReactElement {
  // Other transactions with the same nostr counterparty (Nut Drop / lightning-
  // address-to-nostr). Rendered after the details as a mini relationship view.
  const counterpartyPubkey = entry ? getCounterparty(entry)?.pubkey : undefined;
  return (
    <Screen name={screenName} contentPadding={0} footer={footer}>
      {headerOverride}
      <View testID={testID}>
        <VStack gap={12}>
          {entry ? (
            <HistoryEntryHeader historyEntry={entry} showRecipientAvatar={showRecipientAvatar} />
          ) : null}
          {beforeStatus}
          {entry
            ? (statusRow ?? <HistoryEntryRefresh historyEntry={entry} mintInfo={mintInfo} />)
            : statusRow}
          {entry ? (timeline ?? <HistoryEntryTimeline historyEntry={entry} />) : timeline}
          {children}
          {entry && counterpartyPubkey ? (
            <CounterpartyTransactions pubkey={counterpartyPubkey} excludeId={entry.id} />
          ) : null}
        </VStack>
      </View>
    </Screen>
  );
}
