/**
 * @fileoverview Split-Bill — Detail screen.
 *
 * Top pane: horizontal card deck — one card per participant, each with a
 * seeded-gradient background, avatar, display name, amount, and a scannable
 * BOLT11 QR. Motion matches rn-makeitanimated's `apple-invites` (±0.6°
 * bottom-pivot tilt, ±1 px concave parallax, no scale).
 *
 * Bottom pane: compact list of the same participants with live state pills.
 * Tapping a row snaps the deck to that card. Tapping a failed row re-fires
 * the per-participant delivery via `retryDelivery`.
 *
 * The app-root `<SplitBillPaymentReconciler />` keeps `paymentState` fresh
 * via coco's `history:updated` events; once a participant pays, their card
 * dims + a ✓ chip overlays.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { LegendList, type LegendListRef } from '@legendapp/list';
import { router } from 'expo-router';
import { useHeaderHeight } from '@react-navigation/elements';
import { useManager } from '@cashu/coco-react';
import { z } from 'zod';
import opacity from 'hex-color-opacity';

import { useSplitBillOrchestrator } from '@/features/splitBill/hooks/useSplitBillOrchestrator';
import {
  useSplitBillTransactionsStore,
  type SplitBillParticipant,
} from '@/shared/stores/profile/splitBillTransactionsStore';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { ListRow } from '@/shared/ui/composed/ListRow';
import {
  ParticipantCardDeck,
  type ParticipantCardDeckRef,
} from '@/features/splitBill/components/ParticipantCardDeck';
import { Log, useLifecycleLogger, walletLog, paymentLog } from '@/shared/lib/logger';
import { resolveIdentityName } from '@/shared/lib/identity';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { BLUETOOTH_ACCENT } from '@/shared/lib/brandColors';
import { ParticipantStatusIcon } from '@/features/splitBill/components/ParticipantStatusIcon';
import { participantSubtitle } from '@/features/splitBill/lib/participantSubtitle';

const ParamsSchema = z.object({
  groupId: z.string().min(1).max(256).optional(),
});

export default function SplitBillDetailScreen() {
  useLifecycleLogger('SplitBillDetailScreen', walletLog);
  const params = useRouteParams(ParamsSchema, { where: 'split-bill-flow.detail' });
  const groupId = params?.groupId;
  const [foreground, background, danger, success] = useThemeColor([
    'foreground',
    'background',
    'danger',
    'success',
  ] as const);
  // Modal stack sets `headerTransparent: true` (config/flowLayoutOptions.tsx:47),
  // so the scroll content renders UNDER the native header unless we pad
  // by its height. `useHeaderHeight()` already includes the status-bar
  // inset, so there's no need to add `insets.top` on top of it.
  const headerHeight = useHeaderHeight();

  const group = useSplitBillTransactionsStore((s) => (groupId ? s.groups[groupId] : undefined));
  const { retryDelivery } = useSplitBillOrchestrator();

  const deckRef = useRef<ParticipantCardDeckRef>(null);
  const listRef = useRef<LegendListRef>(null);
  const manager = useManager();
  const [focusedIndex, setFocusedIndex] = useState(0);

  const handleRowPress = useCallback(
    (p: SplitBillParticipant, index: number) => {
      if (!groupId) return;
      // Failed rows still retry inline — keeps the existing "one-tap retry"
      // affordance from the old modal-less layout. Non-failed rows snap the
      // deck AND scroll the outer list back to the top so the user actually
      // sees the card they just selected (the deck is the list header, so
      // scrolling the list to offset 0 reveals it).
      if (p.deliveryState === 'failed' && p.channel !== 'qr-only') {
        paymentLog.info('split_bill.detail.retry_delivery', {
          groupId,
          participantId: p.id,
        });
        void retryDelivery(groupId, p.id);
        return;
      }
      deckRef.current?.scrollToIndex(index);
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
      setFocusedIndex(index);
    },
    [groupId, retryDelivery]
  );

  const handleCardRetry = useCallback(
    (participantId: string) => {
      if (!groupId) return;
      paymentLog.info('split_bill.detail.retry_delivery', { groupId, participantId });
      void retryDelivery(groupId, participantId);
    },
    [groupId, retryDelivery]
  );

  // Navigate to the mint-quote detail screen for a participant — same
  // target that a tapped `Transaction` row on the wallet home uses
  // (features/transactions/components/Transaction.tsx:135-144). Looks up
  // the full `HistoryEntry` from coco's history so the target screen has
  // everything `useScreenActions('mintQuote', …)` expects.
  const handleCardView = useCallback(
    async (participantId: string) => {
      if (!group || !manager) return;
      const p = group.participants.find((x) => x.id === participantId);
      if (!p?.mintQuoteId) return;
      try {
        const history = await manager.history.getPaginatedHistory(0, 200);
        const entry = history.find((h) => h.type === 'mint' && h.quoteId === p.mintQuoteId);
        if (!entry) {
          paymentLog.warn('split_bill.detail.view_lookup_failed', {
            groupId,
            participantId,
            mintQuoteId: p.mintQuoteId,
          });
          return;
        }
        paymentLog.info('split_bill.detail.view', { groupId, participantId });
        router.navigate({
          pathname: '/mintQuote',
          params: { mintHistoryEntry: JSON.stringify(entry) },
        });
      } catch (err) {
        paymentLog.error('split_bill.detail.view_failed', {
          groupId,
          participantId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [group, groupId, manager]
  );

  const listRowBgFor = useCallback(
    (isFocused: boolean) => (isFocused ? opacity(foreground, 0.06) : 'transparent'),
    [foreground]
  );

  const listContent = useMemo(
    () => ({ paddingTop: headerHeight, paddingBottom: 48 }),
    [headerHeight]
  );

  // LegendList's `ListHeaderComponent` accepts an element. Kept as JSX
  // (not a component factory) so React reconciles the same instance
  // across parent re-renders — the deck's internal ScrollView scroll
  // position therefore survives live `paymentState` updates from
  // the app-root SplitBillPaymentReconciler.
  const listHeader = useMemo(
    () =>
      group ? (
        <ParticipantCardDeck
          ref={deckRef}
          group={group}
          onFocusChange={setFocusedIndex}
          onRetry={handleCardRetry}
          onView={handleCardView}
        />
      ) : null,
    [group, handleCardRetry, handleCardView]
  );

  if (!group) {
    return (
      <Log name="SplitBillDetailScreen" style={{ flex: 1, backgroundColor: background }}>
        <View style={styles.emptyCenter}>
          <Text size={14} style={{ color: opacity(foreground, 0.5) }}>
            Split bill not found.
          </Text>
        </View>
      </Log>
    );
  }

  return (
    <Log name="SplitBillDetailScreen" style={{ flex: 1, backgroundColor: background }}>
      <LegendList
        ref={listRef}
        data={group.participants}
        keyExtractor={(p) => p.id}
        estimatedItemSize={68}
        ListHeaderComponent={listHeader}
        renderItem={({ item: p, index }: { item: SplitBillParticipant; index: number }) => {
          const isFocused = index === focusedIndex;
          return (
            <View
              style={{
                backgroundColor: listRowBgFor(isFocused),
                // Always reserve the 3px rail so the row content doesn't
                // shift horizontally when the focused index changes.
                borderLeftWidth: 3,
                borderLeftColor: isFocused ? foreground : 'transparent',
              }}
              testID={`split-bill-row-${p.id}`}>
              <ListRow
                avatar={
                  p.source === 'ble'
                    ? undefined
                    : {
                        picture: p.avatarUrl,
                        name: p.nickname,
                        seed: p.pubkey,
                        size: 40,
                      }
                }
                iconCircle={
                  p.source === 'ble'
                    ? {
                        icon: 'mdi:bluetooth',
                        color: BLUETOOTH_ACCENT,
                        backgroundColor: opacity(BLUETOOTH_ACCENT, 0.12),
                      }
                    : undefined
                }
                title={resolveIdentityName({
                  pubkey: p.pubkey ?? p.peerID,
                  bleNickname: p.nickname,
                  fallbackName: 'Participant',
                })}
                subtitle={participantSubtitle(p, 'detail')}
                accent={
                  <AmountFormatter amount={p.amount} unit={group.unit} size={13} weight="heavy" />
                }
                trailing={
                  <ParticipantStatusIcon
                    participant={p}
                    foreground={foreground}
                    danger={danger}
                    success={success}
                  />
                }
                onPress={() => handleRowPress(p, index)}
              />
            </View>
          );
        }}
        style={{ flex: 1 }}
        contentContainerStyle={listContent}
      />
    </Log>
  );
}

const styles = StyleSheet.create({
  emptyCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
