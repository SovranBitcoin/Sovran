import React, { useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import { Button, Toast } from 'heroui-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import opacity from 'hex-color-opacity';

import { supportsBlur } from '@/shared/lib/version';
import { guardedRouter } from '@/shared/hooks/useGuardedRouter';
import { useSwapStatusStore } from '@/shared/stores/runtime/swapStatusStore';
import type { SwapLeg } from '@/shared/stores/runtime/swapStatusStore';
import { PaymentStatusIcon } from './PaymentStatusIcon';
import { useToastSurface } from './useToastSurface';
import { DANGER_DARK_BG, SUCCESS_DARK_BG, TINT_ALPHA, ToastSlab } from './ToastSlab';

const ICON_SIZE = 32;
const TITLE_FONT_SIZE = 15;
const SUB_FONT_SIZE = 13;

function legSummary(legs: SwapLeg[]): { doneCount: number; total: number } {
  let doneCount = 0;
  for (const l of legs) {
    if (l.status === 'done' || l.status === 'skipped') doneCount += 1;
  }
  return { doneCount, total: legs.length };
}

type SwapStatusToastProps = {
  /** Coming from the toast manager. */
  hide: (ids?: string | string[] | 'all') => void;
  [key: string]: unknown;
};

export function SwapStatusToast({ hide, ...toastProps }: SwapStatusToastProps) {
  const active = useSwapStatusStore((s) => s.active);
  const clear = useSwapStatusStore((s) => s.clear);
  const groupId = active?.groupId;

  const onPressView = useCallback(() => {
    if (!groupId) {
      hide();
      return;
    }
    guardedRouter.push({ pathname: '/swap', params: { groupId } });
    hide();
    clear();
  }, [groupId, hide, clear]);

  // ── Surface colours (theme-invariant dark slab; same approach as
  //    PaymentStatusToast so visual parity is structural). ──
  const { bg: surfaceBg, fg: surfaceFg } = useToastSurface();
  const blurSupported = supportsBlur();
  const surfaceBgTint = blurSupported ? opacity(surfaceBg, TINT_ALPHA) : surfaceBg;

  const isDone = active?.state === 'done';
  const isFailed = active?.state === 'failed';
  const isTerminal = isDone || isFailed;

  const targetBgColor = isFailed ? DANGER_DARK_BG : SUCCESS_DARK_BG;
  const targetBgTint = blurSupported ? opacity(targetBgColor, TINT_ALPHA) : targetBgColor;

  const confirmedProgress = useSharedValue(isTerminal ? 1 : 0);

  useEffect(() => {
    if (isTerminal) {
      confirmedProgress.set(withTiming(1, { duration: 800, easing: Easing.out(Easing.ease) }));
    }
  }, [isTerminal, confirmedProgress]);

  // Auto-dismiss after terminal state, matching PaymentStatusToast (3s).
  useEffect(() => {
    if (!isTerminal) return;
    const timer = setTimeout(() => {
      hide();
      // Drop the active swap from the store so a subsequent run isn't
      // confused by stale "done" state.
      clear();
    }, 3000);
    return () => clearTimeout(timer);
  }, [isTerminal, hide, clear]);

  // If the store cleared while the toast is still in the DOM (race during
  // dismiss), bail out so the toast doesn't render against undefined data.
  const summary = useMemo(() => legSummary(active?.legs ?? []), [active?.legs]);

  const backgroundStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      confirmedProgress.get(),
      [0, 1],
      [surfaceBgTint, targetBgTint]
    ),
  }));

  if (!active) return null;

  const status: 'pending' | 'confirmed' | 'failed' = isFailed
    ? 'failed'
    : isDone
      ? 'confirmed'
      : 'pending';

  const total = summary.total;

  const title = isFailed ? 'Swap failed' : isDone ? 'Swap complete' : 'Swapping';

  // Always render "X of Y swaps" so the toast shows progress from the first
  // frame ("0 of 2 swaps") instead of waiting for the first leg to resolve.
  const subtitle = isFailed
    ? (active.errorMessage ?? `${summary.doneCount} of ${total} swaps`)
    : `${isDone ? total : summary.doneCount} of ${total} swaps`;

  return (
    <ToastSlab
      toastProps={toastProps}
      tint={<Animated.View style={[StyleSheet.absoluteFill, backgroundStyle]} />}>
      <PaymentStatusIcon size={ICON_SIZE} status={status} baseColor={surfaceFg} />

      <View style={{ flex: 1, gap: 2 }}>
        <RNText
          style={{ fontSize: TITLE_FONT_SIZE, fontWeight: '600', color: surfaceFg }}
          numberOfLines={1}>
          {title}
        </RNText>
        {subtitle ? (
          <RNText
            style={{ fontSize: SUB_FONT_SIZE, color: opacity(surfaceFg, 0.85) }}
            numberOfLines={1}>
            {subtitle}
          </RNText>
        ) : null}
      </View>

      {/* "View" action — visible from the moment the toast opens so the
          user can always tap into the SwapTransactionScreen, mid-flight or
          after the fact. Mirrors the same pattern in PaymentStatusToast. */}
      {groupId ? (
        <Toast.Action style={{ backgroundColor: surfaceFg }} onPress={onPressView}>
          <Button.Label style={{ color: surfaceBg }}>View</Button.Label>
        </Toast.Action>
      ) : null}
    </ToastSlab>
  );
}
