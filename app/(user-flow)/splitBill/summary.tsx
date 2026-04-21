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

import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { LegendList } from '@legendapp/list';
import { useRouter, useLocalSearchParams } from 'expo-router';
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
import { ListRow } from '@/shared/ui/composed/ListRow';
import Icon from 'assets/icons';
import { Screen, useLifecycleLogger, walletLog } from '@/shared/lib/logger';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

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
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();
  const [foreground, background, danger, success] = useThemeColor([
    'foreground',
    'background',
    'danger',
    'success',
  ] as const);

  const group = useSplitBillTransactionsStore((s) =>
    groupId ? s.groups[groupId] : undefined
  );
  const { confirm } = useSplitBillOrchestrator();
  useSplitBillPaymentWatcher(groupId);

  const [confirming, setConfirming] = useState(false);
  const hasStarted = group ? group.state !== 'draft' : false;

  const paidCount = group
    ? group.participants.filter((p) => p.paymentState === 'paid').length
    : 0;

  const handleConfirm = useCallback(async () => {
    if (!groupId || confirming) return;
    setConfirming(true);
    try {
      await confirm(groupId);
    } finally {
      setConfirming(false);
    }
  }, [groupId, confirming, confirm]);

  const handleDone = useCallback(async () => {
    router.dismissAll();
  }, [router]);

  // Auto-navigate to detail view after started — cleaner summary UX.
  // (Kept simple: the summary stays until user presses Done.)

  if (!group) {
    return (
      <Screen name="SplitBillSummaryScreen" style={{ flex: 1, backgroundColor: background }}>
        <View style={styles.emptyCenter}>
          <Text size={14} style={{ color: opacity(foreground, 0.5) }}>
            Split bill not found.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen name="SplitBillSummaryScreen" style={{ flex: 1, backgroundColor: background }}>
      <View style={{ flex: 1 }}>
        <VStack align="center" spacing={4} style={styles.headerBlock}>
          <Text size={13} style={{ color: opacity(foreground, 0.5) }}>
            Total bill
          </Text>
          <AmountFormatter
            amount={group.totalAmount}
            unit={group.unit}
            size={30}
            weight="heavy"
            centered
          />
          <Text size={13} style={{ color: opacity(foreground, 0.6), marginTop: 4 }}>
            {hasStarted
              ? `${paidCount} / ${group.participants.length} paid · ${group.state}`
              : `${group.participants.length} participants`}
          </Text>
        </VStack>

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
                      color: '#0A84FF',
                      backgroundColor: opacity('#0A84FF', 0.12),
                    }
                  : undefined
              }
              title={p.nickname ?? p.pubkey?.slice(0, 12) ?? p.peerID ?? 'Participant'}
              subtitle={participantSubtitle(p)}
              accent={
                <AmountFormatter
                  amount={p.amount}
                  unit={group.unit}
                  size={13}
                  weight="heavy"
                />
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
          contentContainerStyle={{ paddingBottom: 140 }}
        />
      </View>

      <BottomButtons style={{ position: 'relative' }} paddingBottom={16}>
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerBlock: {
    paddingTop: 16,
    paddingBottom: 12,
  },
  emptyCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
