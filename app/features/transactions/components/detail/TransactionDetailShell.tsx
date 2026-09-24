import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, type ScrollView, type View as NativeView } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { useIdentityHeader, type HeaderIdentity } from '@/shared/ui/composed/IdentityHeader';
import { transactionHeaderTitle, type SpendingConditions } from 'wallet';

import { useDeferredMount } from '@/shared/hooks/useDeferredMount';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { ContactRow, nostrIdentity } from '@/shared/ui/composed/ContactRow';
import { navigateToProfile } from '@/features/contacts/lib/navigateToProfile';
import { Screen, useScreenOptions } from '@/shared/ui/composed/Screen';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HistoryEntryHeader } from '@/features/transactions/components/detail/HistoryEntryHeader';
import { HistoryEntryRefresh } from '@/features/transactions/components/detail/HistoryEntryRefresh';
import { HistoryEntryTimeline } from '@/features/transactions/components/detail/timeline';
import { TransactionProbe } from '@/features/transactions/components/detail/TransactionProbe';
import {
  transactionIdentitySnapshot,
  useTransactionIdentity,
} from '@/features/transactions/lib/transactionIdentity';
import { CounterpartyTransactions } from '@/features/transactions/components/CounterpartyTransactions';
import { E2EActionMenuProbe } from '@/shared/lib/popup/E2EActionMenuProbe';
import { E2EToastProbe } from '@/shared/lib/popup/E2EToastProbe';

type DetailEntry = React.ComponentProps<typeof HistoryEntryTimeline>['historyEntry'];
type MintInfo = React.ComponentProps<typeof HistoryEntryRefresh>['mintInfo'];

interface TransactionDetailShellProps {
  /** Focus the timeline on an explicit action; later status/layout changes keep it anchored. */
  timelineFocusKey?: string;
  cancelling?: boolean;
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
  /** Safe presentation source used by the structured device-test probe. */
  source?: string | null;
  /** Whether the header shows the recipient avatar (sends with a recipient). */
  showRecipientAvatar?: boolean;
  /** See `HistoryEntryHeader.badge` — what the avatar's corner disc says. */
  headerBadge?: 'direction' | 'lock' | 'none';
  /** The send's spending conditions, surfaced to the device harness as enums. */
  conditions?: SpendingConditions | null;
  /** Footer (bottom buttons). */
  footer: React.ReactNode;
  /**
   * Counterparty identity that hands off from the body avatar to the compact
   * navigation title while scrolling. Optional: when a screen supplies none,
   * the shell derives one from the entry (`useTransactionIdentity`), so a
   * zapped post, a Nut Drop or a processing send all morph without each screen
   * repeating the lookup. A screen only passes this to say something the entry
   * cannot — the melt preview's "Pay <name>".
   */
  headerIdentity?: HeaderIdentity;
  /**
   * Overrides the derived title. Leave it unset: the shell names the screen
   * from the entry's rail and state (`transactionHeaderTitle`), so a settled
   * payment reads "Sent Lightning" / "Paid Alex" instead of instructing the
   * user to send something the wallet already sent.
   */
  headerTitle?: string;
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

function DeferredCounterpartyTransactions(
  props: React.ComponentProps<typeof CounterpartyTransactions>
) {
  const ready = useDeferredMount();
  return ready ? <CounterpartyTransactions {...props} /> : null;
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
  timelineFocusKey,
  cancelling,
  screenName,
  testID,
  entry,
  mintInfo,
  source,
  showRecipientAvatar = false,
  headerBadge = 'direction',
  conditions = null,
  footer,
  headerIdentity,
  headerTitle,
  beforeStatus,
  statusRow,
  timeline,
  children,
}: TransactionDetailShellProps): React.ReactElement {
  const entryIdentity = useTransactionIdentity(entry);
  const namedIdentity = headerIdentity ?? entryIdentity;
  // One phrase names the screen and the person: the collapsed bar shows the
  // icon and this title beneath it, so "Paid Alex" must not become "Alex" on
  // the way into the header.
  const title =
    headerTitle ?? transactionHeaderTitle(entry, { counterpartyName: namedIdentity?.name });
  const identity = namedIdentity ? { ...namedIdentity, name: title } : undefined;
  const morph = useIdentityHeader({ identity, title, collapseAt: 48 });
  useScreenOptions(
    () => (title ? { headerTitle: morph.headerTitle } : {}),
    [title, identity?.picture, identity?.seed]
  );
  const scrollViewRef = useRef<ScrollView>(null);
  const scrollContentRef = useRef<NativeView>(null);
  const timelineRef = useRef<NativeView>(null);
  const headerHeightRef = useRef(0);
  const lastFocusRef = useRef<{ key: string; y: number } | null>(null);
  const reducedMotion = useReducedMotion();
  const focusTimeline = useCallback(() => {
    const content = scrollContentRef.current;
    if (timelineFocusKey === undefined || !content) return;
    timelineRef.current?.measureLayout(content, (_x, y) => {
      const targetY = y - headerHeightRef.current - 16;
      const previous = lastFocusRef.current;
      if (previous?.key === timelineFocusKey && previous.y === targetY) return;
      scrollViewRef.current?.scrollTo({
        y: targetY,
        animated: previous?.key !== timelineFocusKey && !!cancelling && !reducedMotion,
      });
      lastFocusRef.current = { key: timelineFocusKey, y: targetY };
    });
  }, [timelineFocusKey, cancelling, reducedMotion]);
  useEffect(() => {
    if (timelineFocusKey === undefined) return;
    const frame = requestAnimationFrame(focusTimeline);
    return () => cancelAnimationFrame(frame);
  }, [focusTimeline, timelineFocusKey]);
  const recordHeaderHeight = useCallback((height: number) => {
    headerHeightRef.current = height;
  }, []);
  // Other transactions with the same nostr counterparty (Nut Drop / lightning-
  // address-to-nostr). Rendered before technical details as a mini relationship view.
  const counterpartyPubkey = transactionIdentitySnapshot(entry)?.pubkey;
  const { metadata: counterpartyProfile } = useNostrProfileMetadata(counterpartyPubkey);
  // The scroll mode picks its container, so it must not flip once mounted: it
  // follows the pubkey the entry carries (known synchronously), not the name
  // the profile fetch resolves later.
  const canMorph = !!headerIdentity || !!transactionIdentitySnapshot(entry);
  // Paint the known header/QR frame immediately; unrelated-history enrichment
  // keeps its previous deferred mount below the transaction timeline.
  return (
    <Screen
      name={screenName}
      scroll={canMorph ? 'animated' : 'auto'}
      scrollY={morph.scrollY}
      headerBand={morph.headerBand}
      contentPadding={0}
      footer={footer}
      deferContent={false}
      scrollViewRef={scrollViewRef}
      scrollContentRef={scrollContentRef}
      onHeaderHeightChange={recordHeaderHeight}>
      {identity ? morph.probe : null}
      <E2EToastProbe />
      <E2EActionMenuProbe />
      <View
        testID={testID}
        accessible
        accessibilityRole="text"
        accessibilityLabel="Transaction detail ready"
        importantForAccessibility="yes"
        collapsable={false}
        pointerEvents="none"
        style={styles.routeReadyProbe}
      />
      <View>
        <VStack gap={12}>
          {entry ? (
            <>
              <TransactionProbe
                entry={entry}
                source={source}
                transactionId={entry.id}
                conditions={conditions}
              />
              <HistoryEntryHeader
                historyEntry={entry}
                showRecipientAvatar={showRecipientAvatar}
                badge={headerBadge}
                identity={headerIdentity}
                identityStyle={morph.contentStyle}
              />
            </>
          ) : null}
          {beforeStatus}
          {entry
            ? (statusRow ?? <HistoryEntryRefresh historyEntry={entry} mintInfo={mintInfo} />)
            : statusRow}
          {(entry || timeline) && (
            <View
              ref={timelineRef}
              collapsable={false}
              onLayout={focusTimeline}
              testID="transaction-timeline-anchor">
              {entry
                ? (timeline ?? (
                    <HistoryEntryTimeline historyEntry={entry} cancelling={cancelling} />
                  ))
                : timeline}
            </View>
          )}
          {entry && counterpartyPubkey ? (
            <>
              <ContactRow
                identity={nostrIdentity(counterpartyPubkey, counterpartyProfile ?? undefined)}
                subtitle="View this person’s profile"
                hideMetadata
                trailingVariant="chevron"
                testID="transaction-counterparty-profile"
                onPress={() => navigateToProfile(counterpartyPubkey)}
              />
              <DeferredCounterpartyTransactions pubkey={counterpartyPubkey} excludeId={entry.id} />
            </>
          ) : null}
          {children}
        </VStack>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  routeReadyProbe: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 1,
    height: 1,
  },
});
