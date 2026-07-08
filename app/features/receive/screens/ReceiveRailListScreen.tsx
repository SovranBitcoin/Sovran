/**
 * "View all" screen for a receive rail — payment requests, onchain addresses,
 * or bolt12 offers. A real `(receive-flow)` route (not a bottom sheet) so that
 * tapping a paid row PUSHES its transaction detail into the same stack and
 * slides in from the side — mirroring mint info → reviews.
 *
 * Row tap is status-driven (see `receiveRailItems`):
 * - copyable (reusable / awaiting) → copy the value.
 * - paid with a resolved transaction → push that transaction's detail.
 * - paid/replaced/expired with nothing to open → a short toast explaining why
 *   copying is disabled (a paid address/request is hidden for privacy).
 */

import React, { memo, useCallback, useEffect, useState } from 'react';

import { ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { ListGroup, PressableFeedback, Separator } from 'heroui-native';
import { setStringAsync } from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';
import opacity from 'hex-color-opacity';

import type { Manager } from '@cashu/coco-core';
import { standingPaymentRequestKey } from 'wallet';
import { useColadaManager } from 'wallet/react';
import {
  buildBolt12Items,
  buildOnchainItems,
  buildPaymentRequestItems,
  isRailItemCopyable,
  type ReceiveRail,
  type RailStatus,
  type ReceiveRailItem,
} from '@/features/receive/lib/receiveRailItems';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { Badge } from '@/shared/ui/primitives/Badge';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { truncateMiddle } from '@/shared/lib/strings';
import { formatAmount } from '@/shared/lib/currency';
import { formatRelative } from '@/shared/lib/date';
import { copyPopup, paramPopup } from '@/shared/lib/popup';
import { navigateToTransactionDetail } from '@/shared/lib/nav/transactionDetailRoutes';
import { paymentLog } from '@/shared/lib/logger';
import Icon from 'assets/icons';

type BadgeVariant = React.ComponentProps<typeof Badge>['variant'];

const RAIL_TITLE: Record<ReceiveRail, string> = {
  paymentRequest: 'Payment requests',
  onchain: 'Onchain addresses',
  bolt12: 'Bolt12 offers',
};

// `secondary` renders its text in `surface-secondary` (a near-background tone)
// — illegible on the faint badge fill. Use `primary` (foreground text) for the
// neutral states so "Reusable"/"Expired" read clearly.
const STATUS_BADGE: Record<RailStatus, { label: string; variant: BadgeVariant; icon?: string }> = {
  reusable: { label: 'Reusable', variant: 'primary', icon: 'mdi:refresh' },
  awaiting: { label: 'Awaiting', variant: 'warning' },
  paid: { label: 'Paid', variant: 'success', icon: 'fluent:checkmark-16-filled' },
  cancelled: { label: 'Replaced', variant: 'error' },
  expired: { label: 'Expired', variant: 'primary' },
};

// Why a non-copyable row can't be copied — shown as a toast on tap when there
// is also no transaction to open.
const NON_COPYABLE_TOAST: Record<
  Exclude<RailStatus, 'reusable' | 'awaiting'>,
  { title: string; message: string }
> = {
  paid: {
    title: 'Already paid',
    message: 'This is hidden to protect your privacy — reusing it would link your payments.',
  },
  cancelled: { title: 'Replaced', message: 'This was replaced by a newer request.' },
  expired: { title: 'Expired', message: 'This address is no longer valid.' },
};

async function loadRailItems(
  manager: Manager,
  rail: ReceiveRail,
  unit: string
): Promise<ReceiveRailItem[]> {
  const standingQuotes = useMintStore.getState().standingQuotes;
  if (rail === 'paymentRequest') {
    return buildPaymentRequestItems(manager, {
      standingId: standingQuotes[standingPaymentRequestKey(unit)],
    });
  }
  const standingIds = new Set(Object.values(standingQuotes));
  return rail === 'onchain'
    ? buildOnchainItems(manager, { standingIds })
    : buildBolt12Items(manager, { standingIds });
}

interface ReceiveRailRowProps {
  item: ReceiveRailItem;
  muted: string;
  accent: string;
  onPress: (item: ReceiveRailItem) => void;
}

const ReceiveRailRow = memo(function ReceiveRailRow({
  item,
  muted,
  accent,
  onPress,
}: ReceiveRailRowProps) {
  const badge = STATUS_BADGE[item.status];
  const copyable = isRailItemCopyable(item.status);

  const descriptionParts = [
    item.amount
      ? formatAmount(
          { amount: item.amount.value, unit: item.amount.unit },
          { useUserPreference: true }
        )
      : null,
    item.mintName,
    formatRelative(item.createdAt, 'compact'),
  ].filter((part): part is string => !!part);

  return (
    <PressableFeedback animation={false} onPress={() => onPress(item)}>
      <PressableFeedback.Scale>
        <ListGroup.Item disabled>
          <ListGroup.ItemPrefix>
            {item.mintUrl ? (
              <MintIcon iconUrl={item.mintIconUrl} name={item.mintName} size={32} />
            ) : (
              <Icon name="ph:coins" size={22} color={muted} />
            )}
          </ListGroup.ItemPrefix>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle numberOfLines={1}>
              {truncateMiddle(item.request, 12)}
            </ListGroup.ItemTitle>
            <ListGroup.ItemDescription numberOfLines={1}>
              {descriptionParts.join(' · ')}
            </ListGroup.ItemDescription>
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix>
            <HStack align="center" gap={8}>
              {item.isCurrent ? <Icon name="mdi:check" size={18} color={accent} /> : null}
              <Badge variant={badge.variant} icon={badge.icon} size={12}>
                {badge.label}
              </Badge>
              {copyable ? (
                <Icon name="lets-icons:copy" size={18} color={muted} />
              ) : item.linkEntry ? (
                <Icon name="mdi:chevron-right" size={18} color={muted} />
              ) : null}
            </HStack>
          </ListGroup.ItemSuffix>
        </ListGroup.Item>
      </PressableFeedback.Scale>
      <PressableFeedback.Ripple />
    </PressableFeedback>
  );
});

// Skeleton row mirroring ReceiveRailRow's layout (icon · two lines · badge) so
// the loading state matches the real chrome — same `surface-secondary` fill and
// pulse as every other skeleton in the app.
const ReceiveRailRowSkeleton = memo(function ReceiveRailRowSkeleton({
  skeletonColor,
}: {
  skeletonColor: string;
}) {
  const bar = (width: number, height: number) => (
    <Skeleton style={{ width, height, borderRadius: 4, backgroundColor: skeletonColor }} />
  );
  return (
    <ListGroup.Item disabled>
      <ListGroup.ItemPrefix>
        <Skeleton
          style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: skeletonColor }}
        />
      </ListGroup.ItemPrefix>
      <ListGroup.ItemContent>
        <VStack spacing={6}>
          {bar(150, 15)}
          {bar(96, 12)}
        </VStack>
      </ListGroup.ItemContent>
      <ListGroup.ItemSuffix>
        <Skeleton
          style={{ width: 72, height: 22, borderRadius: 999, backgroundColor: skeletonColor }}
        />
      </ListGroup.ItemSuffix>
    </ListGroup.Item>
  );
});

const ParamsSchema = z.object({
  rail: z.enum(['paymentRequest', 'onchain', 'bolt12']),
  unit: z.string().max(16).default('sat'),
});

export function ReceiveRailListScreen() {
  const params = useRouteParams(ParamsSchema, { where: 'receive-flow.railList' });
  const manager = useColadaManager();
  const insets = useSafeAreaInsets();
  const [background, foreground, accent, skeletonColor] = useThemeColor([
    'background',
    'foreground',
    'accent',
    'surface-secondary',
  ] as const);
  const muted = opacity(foreground, 0.4);

  const rail = params?.rail;
  const unit = params?.unit ?? 'sat';
  const [state, setState] = useState<{ loading: boolean; items: ReceiveRailItem[] }>({
    loading: true,
    items: [],
  });

  useEffect(() => {
    if (!rail) return;
    let cancelled = false;
    setState({ loading: true, items: [] });
    void (async () => {
      try {
        const items = await loadRailItems(manager, rail, unit);
        if (!cancelled) setState({ loading: false, items });
      } catch (error) {
        paymentLog.warn('receive.rail_list.load_failed', {
          rail,
          error: error instanceof Error ? error.message : String(error),
        });
        if (!cancelled) setState({ loading: false, items: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [manager, rail, unit]);

  const handlePress = useCallback((item: ReceiveRailItem) => {
    if (isRailItemCopyable(item.status)) {
      void EnhancedHaptics.copyHaptic();
      void setStringAsync(item.request);
      copyPopup(item.copyTarget);
      paymentLog.info('receive.rail_list.copied', { rail: item.rail, status: item.status });
      return;
    }
    if (item.linkEntry) {
      // Push the transaction detail into this same (receive-flow) stack — it
      // slides in from the side, and Back returns to this list.
      paymentLog.info('receive.rail_list.open_transaction', { rail: item.rail });
      navigateToTransactionDetail(item.linkEntry, 'receive_rail_list');
      return;
    }
    // Non-copyable with nothing to open — explain why (privacy for paid).
    const toast =
      NON_COPYABLE_TOAST[item.status as keyof typeof NON_COPYABLE_TOAST] ?? NON_COPYABLE_TOAST.paid;
    paymentLog.info('receive.rail_list.copy_blocked', { rail: item.rail, status: item.status });
    paramPopup('action-unavailable', toast);
  }, []);

  if (!params || !rail) return null;

  const topPad = insets.top + 48;

  return (
    <View style={{ flex: 1, backgroundColor: background }}>
      <Stack.Screen options={{ title: RAIL_TITLE[rail] }} />
      <ScrollView
        // Android form-sheet: top-edge drag dismisses, mid-scroll scrolls.
        nestedScrollEnabled
        contentContainerStyle={{
          paddingHorizontal: 8,
          paddingTop: topPad,
          paddingBottom: insets.bottom + 32,
        }}
        showsVerticalScrollIndicator={false}>
        {state.loading ? (
          <GradientCard>
            <ListGroup variant="transparent">
              {[0, 1, 2, 3].map((i) => (
                <React.Fragment key={i}>
                  {i > 0 ? <Separator className="mx-4" /> : null}
                  <ReceiveRailRowSkeleton skeletonColor={skeletonColor} />
                </React.Fragment>
              ))}
            </ListGroup>
          </GradientCard>
        ) : state.items.length === 0 ? (
          <Text size={14} className="text-muted mt-6 text-center">
            Nothing here yet.
          </Text>
        ) : (
          <GradientCard>
            <ListGroup variant="transparent">
              {state.items.map((item, index) => (
                <React.Fragment key={item.key}>
                  {index > 0 ? <Separator className="mx-4" /> : null}
                  <ReceiveRailRow item={item} muted={muted} accent={accent} onPress={handlePress} />
                </React.Fragment>
              ))}
            </ListGroup>
          </GradientCard>
        )}
      </ScrollView>
    </View>
  );
}
