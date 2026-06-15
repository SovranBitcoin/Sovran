import React from 'react';

import { Screen } from '@/shared/ui/composed/Screen';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HistoryEntryHeader } from '@/features/transactions/components/detail/HistoryEntryHeader';
import { HistoryEntryRefresh } from '@/features/transactions/components/detail/HistoryEntryRefresh';
import { HistoryEntryTimeline } from '@/features/transactions/components/detail/HistoryEntryTimeline';

type DetailEntry = React.ComponentProps<typeof HistoryEntryTimeline>['historyEntry'];
type MintInfo = React.ComponentProps<typeof HistoryEntryRefresh>['mintInfo'];

interface TransactionDetailShellProps {
  /** Screen telemetry/name. */
  screenName: string;
  /** Stable per-entry testID (e.g. `send-token-id-${entry.id}`). */
  testID: string;
  /** The decorated history entry; fed to header/refresh/timeline. */
  entry: DetailEntry;
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
 * differ; the shell assumes a resolved `entry`.
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
  return (
    <Screen name={screenName} contentPadding={0} footer={footer}>
      {headerOverride}
      <View testID={testID}>
        <VStack gap={12}>
          <HistoryEntryHeader historyEntry={entry} showRecipientAvatar={showRecipientAvatar} />
          {beforeStatus}
          {statusRow ?? <HistoryEntryRefresh historyEntry={entry} mintInfo={mintInfo} />}
          {timeline ?? <HistoryEntryTimeline historyEntry={entry} />}
          {children}
        </VStack>
      </View>
    </Screen>
  );
}
