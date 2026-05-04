/**
 * @fileoverview Split-Bill — Step 3: review + confirm.
 *
 * Shows each participant with their share and live delivery / payment
 * status. The "Confirm & Send" button runs the orchestrator, which
 * generates mint-quotes and auto-delivers invoices in sequence. After
 * confirmation, the page stays mounted and updates in place so the user
 * can see delivery + payment transitions. A "Done" button routes to the
 * detail screen (same view, reached via Transactions).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet } from 'react-native';
import { LegendList } from '@legendapp/list';
import { z } from 'zod';

import { useGuardedRouter as useRouter } from '@/shared/hooks/useGuardedRouter';
import { useHeaderHeight } from '@react-navigation/elements';
import opacity from 'hex-color-opacity';

import {
  useSplitBillOrchestrator,
  useSplitBillPaymentWatcher,
} from '@/features/splitBill/hooks/useSplitBillOrchestrator';
import {
  useSplitBillTransactionsStore,
  type SplitBillParticipant,
} from '@/shared/stores/profile/splitBillTransactionsStore';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler, type ButtonHandlerButton } from '@/shared/ui/composed/ButtonHandler';
import { HistoryEntryHeader } from '@/features/transactions';
import { ListRow } from '@/shared/ui/composed/ListRow';
import Icon from 'assets/icons';
import { Log, useLifecycleLogger, useRenderLogger, walletLog } from '@/shared/lib/logger';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { BLUETOOTH_ACCENT } from '@/shared/lib/brandColors';

const ParamsSchema = z.object({
  groupId: z.string().min(1).max(256).optional(),
});

function ParticipantStatusIcon({
  participant,
  foreground,
  danger,
  success,
}: {
  participant: SplitBillParticipant;
  foreground: string;
  danger: string;
  success: string;
}) {
  if (participant.paymentState === 'paid') {
    return <Icon name="mdi:check-circle" size={22} color={success} />;
  }
  if (participant.paymentState === 'expired') {
    return <Icon name="mdi:alert-circle" size={22} color={danger} />;
  }
  if (participant.deliveryState === 'failed') {
    return <Icon name="mdi:alert-circle" size={22} color={danger} />;
  }
  if (participant.deliveryState === 'pending') {
    return (
      <Icon
        name="ant-design:loading-outlined"
        size={22}
        color={opacity(foreground, 0.4)}
        spin={{ duration: 1000, outputRange: ['0deg', '360deg'], delay: 0, easing: 'linear' }}
      />
    );
  }
  // sent, awaiting payment
  return <Icon name="mdi:clock-outline" size={22} color={opacity(foreground, 0.5)} />;
}

function participantSubtitle(p: SplitBillParticipant): string {
  if (p.paymentState === 'paid') return 'Paid ✓';
  if (p.paymentState === 'expired') return 'Expired';
  if (p.deliveryState === 'failed') return 'Delivery failed';
  if (p.channel === 'qr-only') return 'Awaiting payment · tap for QR';
  if (p.deliveryState === 'pending') return 'Sending invoice…';
  return 'Invoice delivered · awaiting payment';
}

export default function SplitBillSummaryScreen() {
  useLifecycleLogger('SplitBillSummaryScreen', walletLog);
  // Summary stays mounted through the whole confirm + watcher cycle; expect
  // one render per delivery + one per payment flip. Warn past 60.
  useRenderLogger('SplitBillSummaryScreen', 60, walletLog);
  const router = useRouter();
  const params = useRouteParams(ParamsSchema, { where: 'split-bill-flow.summary' });
  const groupId = params?.groupId;
  const [foreground, background, danger, success] = useThemeColor([
    'foreground',
    'background',
    'danger',
    'success',
  ] as const);
  const headerHeight = useHeaderHeight();

  const group = useSplitBillTransactionsStore((s) => (groupId ? s.groups[groupId] : undefined));
  const { confirm } = useSplitBillOrchestrator();
  useSplitBillPaymentWatcher(groupId);

  const [confirming, setConfirming] = useState(false);
  const hasStarted = group ? group.state !== 'draft' : false;

  // Reserve space for the floating bottom bar on the list. Hardcoding this
  // clipped content when the button wrapped or safe-area insets grew, so we
  // measure the rendered bar instead. 120 is the participants-screen default
  // and a safe initial estimate for the first frame.
  const [bottomBarHeight, setBottomBarHeight] = useState(120);
  const handleBottomBarLayout = useCallback((event: LayoutChangeEvent) => {
    const h = event.nativeEvent.layout.height;
    setBottomBarHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
  }, []);

  const paidCount = group ? group.participants.filter((p) => p.paymentState === 'paid').length : 0;

  // Group-state transitions (draft → awaiting → finalized). One event per
  // transition so log-doctor timelines can correlate orchestrator events
  // with the UI view.
  const prevGroupState = useRef<string | undefined>(group?.state);
  useEffect(() => {
    if (group && prevGroupState.current !== group.state) {
      walletLog.info('split_bill.summary.state_transition', {
        groupId: group.id,
        from: prevGroupState.current,
        to: group.state,
        participants: group.participants.length,
      });
      prevGroupState.current = group.state;
    }
  }, [group?.id, group?.state, group?.participants.length, group]);

  // Payment-progress transitions (paidCount flips).
  const prevPaidCount = useRef(paidCount);
  useEffect(() => {
    if (group && prevPaidCount.current !== paidCount) {
      walletLog.info('split_bill.summary.paid_count', {
        groupId: group.id,
        paid: paidCount,
        total: group.participants.length,
        delta: paidCount - prevPaidCount.current,
      });
      prevPaidCount.current = paidCount;
    }
  }, [paidCount, group]);

  const handleConfirm = useCallback(async () => {
    if (!groupId || confirming) return;
    setConfirming(true);
    try {
      await confirm(groupId);
      // After confirm transitions the group to `awaiting`, hand the user off
      // to the Split Bill detail (per-participant deck + payment watcher).
      // Replace so back doesn't drop us on a now-stale summary screen.
      router.replace({
        pathname: '/(split-bill-flow)/detail',
        params: { groupId },
      });
    } finally {
      setConfirming(false);
    }
  }, [groupId, confirming, confirm, router]);

  const handleDone = useCallback(async () => {
    router.dismissAll();
  }, [router]);

  // Auto-navigate to detail view after started — cleaner summary UX.
  // (Kept simple: the summary stays until user presses Done.)

  if (!group) {
    return (
      <Log name="SplitBillSummaryScreen" style={{ flex: 1, backgroundColor: background }}>
        <View style={styles.emptyCenter}>
          <Text size={14} style={{ color: opacity(foreground, 0.5) }}>
            Split bill not found.
          </Text>
        </View>
      </Log>
    );
  }

  return (
    <Log name="SplitBillSummaryScreen" style={{ flex: 1, backgroundColor: background }}>
      <View style={{ flex: 1, paddingTop: headerHeight }}>
        {/* Shared amount header — same component used by Mint/Melt/Send/ReceiveToken. */}
        <HistoryEntryHeader
          pendingData={{ amount: group.totalAmount, unit: group.unit, type: 'receive' }}
        />

        {/* Status caption — participant count before confirm, paid-count after. */}
        <View style={styles.statusCaption}>
          <Text size={13} style={{ color: opacity(foreground, 0.5) }}>
            {hasStarted
              ? `${paidCount} / ${group.participants.length} paid · ${group.state}`
              : `${group.participants.length} participants`}
          </Text>
        </View>

        <LegendList
          data={group.participants}
          keyExtractor={(p) => p.id}
          estimatedItemSize={68}
          renderItem={({ item: p }) => (
            <ListRow
              avatar={
                p.source === 'ble'
                  ? undefined
                  : {
                      picture: p.avatarUrl,
                      name: p.nickname,
                      seed: p.pubkey,
                      size: 44,
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
              title={p.nickname ?? p.pubkey?.slice(0, 12) ?? p.peerID ?? 'Participant'}
              subtitle={participantSubtitle(p)}
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
            />
          )}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: bottomBarHeight + 24 }}
        />
      </View>

      <BottomButtons style={{ position: 'relative' }} onLayout={handleBottomBarLayout}>
        <HStack justify="center" align="center">
          <ButtonHandler
            buttons={
              (hasStarted
                ? [
                    {
                      testID: 'split-bill-summary-done',
                      text: 'Done',
                      icon: 'material-symbols:check-rounded',
                      variant: 'primary',
                      onPress: handleDone,
                    },
                  ]
                : [
                    {
                      testID: 'split-bill-summary-confirm',
                      text: 'Confirm & Send',
                      icon: 'iconamoon:send-fill',
                      variant: 'primary',
                      onPress: handleConfirm,
                      loading: confirming,
                      disabled: confirming,
                    },
                  ]) as ButtonHandlerButton[]
            }
          />
        </HStack>
      </BottomButtons>
    </Log>
  );
}

const styles = StyleSheet.create({
  statusCaption: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 12,
  },
  emptyCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
