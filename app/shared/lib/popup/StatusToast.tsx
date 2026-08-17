import React, { useEffect } from 'react';
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

import { LoadingIndicator, type Phase, type Result } from '@/shared/blocks/status';
import { popupLog } from '@/shared/lib/logger';

import { blendColors } from '@/shared/lib/colorExtraction';

import { useToastSurface } from './useToastSurface';
import {
  DANGER_DARK_BG,
  OPAQUE_TINT_MIX,
  SUCCESS_DARK_BG,
  TINT_ALPHA,
  ToastSlab,
  WARNING_DARK_BG,
  useToastFrosted,
} from './ToastSlab';

const ICON_SIZE = 32;
const TITLE_FONT_SIZE = 15;
const SUB_FONT_SIZE = 13;
const TERMINAL_TINT_DURATION_MS = 800;
/** The e2e harness cannot screenshot inside the 3s auto-dismiss window (the
 * confirmed AX probe outlives the visible toast by 15s, and per-step evidence
 * capture alone costs ~1s), so its owned Metro slows terminal toasts via env.
 * Unset outside e2e dev sessions. */
const E2E_DISMISS_MS = __DEV__ ? Number(process.env.EXPO_PUBLIC_E2E_TOAST_DISMISS_MS) : NaN;
const AUTO_DISMISS_MS =
  Number.isFinite(E2E_DISMISS_MS) && E2E_DISMISS_MS > 0 ? E2E_DISMISS_MS : 3000;

export type StatusToastStatus = 'pending' | 'delivered' | 'confirmed' | 'failed' | 'warning';

type StatusToastProps = {
  status: StatusToastStatus;
  title: string;
  /**
   * Optional subtitle. Strings render in the standard 13px row; a node lets
   * callers compose their own row (e.g. `PaymentStatusToast`'s segmented
   * amount form).
   */
  subtitle?: React.ReactNode;
  /** Right-aligned action pill. Hidden when omitted. */
  action?: { label: string; onPress: () => void; testID?: string };
  /** Stable marker for the caller's current lifecycle state. */
  statusTestID?: string;
  /**
   * Optional segmented ring. When set, the indicator fills `completedSegments`
   * of `segmentCount` arcs instead of an indeterminate spinner — used by the
   * post Delete toast to show per-image + per-relay progress. Omitted by the
   * swap/payment toasts, which keep the plain spinner.
   */
  segmentedProgress?: { completedSegments: number | null; segmentCount: number };
  /** Override the indicator stroke (pending segments / spinner). */
  ringColor?: string;
  /** Override the filled-segment / success color (e.g. red for delete). */
  ringSuccessColor?: string;
  /** Indicator diameter; defaults to ICON_SIZE (32). */
  indicatorSize?: number;
  /** Structured lifecycle context for log-doctor toast audits. */
  debugFields?: Record<string, unknown>;
  /**
   * From the heroui toast manager — `hide` plus internal positioning props.
   * Spread onto the underlying `<Toast>` root.
   */
  toastProps: Record<string, unknown> & { hide: (ids?: string | string[] | 'all') => void };
};

/**
 * Animated terminal-state toast shell shared by `PaymentStatusToast` and
 * `SwapStatusToast`.
 *
 * Renders the frosted-glass slab with a `<LoadingIndicator>`, title + optional
 * subtitle, and optional action pill. The tint background interpolates from
 * the theme surface to success, warning, or danger when `status` flips to a
 * terminal value (`'confirmed'`, `'warning'`, or `'failed'`); 3 seconds later
 * the toast manager is told to hide. `'pending'` and `'delivered'` are
 * non-terminal and keep the toast visible until the caller flips status or
 * unmounts the component.
 */
export function StatusToast({
  status,
  title,
  subtitle,
  action,
  statusTestID,
  segmentedProgress,
  ringColor,
  ringSuccessColor,
  indicatorSize,
  debugFields,
  toastProps,
}: StatusToastProps) {
  const { bg: surfaceBg, fg: surfaceFg } = useToastSurface();
  // Opaque on non-frosted platforms (Android) — see ToastSlab.
  const frosted = useToastFrosted();
  const surfaceBgTint = frosted ? opacity(surfaceBg, TINT_ALPHA) : surfaceBg;

  const isTerminal = status === 'confirmed' || status === 'warning' || status === 'failed';
  const targetBg =
    status === 'failed' ? DANGER_DARK_BG : status === 'warning' ? WARNING_DARK_BG : SUCCESS_DARK_BG;
  // Frosted: translucent tint, the blur supplies the softness. Opaque:
  // composite the same tint into the surface slab mathematically —
  // raw SUCCESS/DANGER hexes at full opacity read far too strong.
  const targetBgTint = frosted
    ? opacity(targetBg, TINT_ALPHA)
    : blendColors(surfaceBg, targetBg, OPAQUE_TINT_MIX);

  const indicatorPhase: Phase = isTerminal ? 'done' : 'loading';
  const indicatorResult: Result =
    status === 'failed' ? 'error' : status === 'warning' ? 'warning' : 'success';

  const confirmedProgress = useSharedValue(isTerminal ? 1 : 0);

  useEffect(() => {
    if (!isTerminal) return;
    confirmedProgress.set(
      withTiming(1, { duration: TERMINAL_TINT_DURATION_MS, easing: Easing.out(Easing.ease) })
    );
  }, [isTerminal, confirmedProgress]);

  const hide = toastProps.hide;
  useEffect(() => {
    if (!isTerminal) return;
    popupLog.info('popup.status_toast.auto_dismiss_scheduled', {
      status,
      title,
      delayMs: AUTO_DISMISS_MS,
      ...(debugFields ?? {}),
    });
    const timer = setTimeout(() => {
      popupLog.info('popup.status_toast.auto_dismiss_fired', {
        status,
        title,
        ...(debugFields ?? {}),
      });
      hide();
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [debugFields, hide, isTerminal, status, title]);

  const backgroundStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      confirmedProgress.get(),
      [0, 1],
      [surfaceBgTint, targetBgTint]
    ),
  }));

  return (
    <ToastSlab
      toastProps={toastProps}
      tint={<Animated.View style={[StyleSheet.absoluteFill, backgroundStyle]} />}>
      <LoadingIndicator
        size={indicatorSize ?? ICON_SIZE}
        phase={indicatorPhase}
        result={indicatorResult}
        color={ringColor ?? surfaceFg}
        {...(ringSuccessColor ? { successColor: ringSuccessColor } : {})}
        {...(segmentedProgress ? { segmentedProgress } : {})}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <RNText
          testID={statusTestID}
          style={{ fontSize: TITLE_FONT_SIZE, fontWeight: '600', color: surfaceFg }}
          numberOfLines={1}>
          {title}
        </RNText>
        {typeof subtitle === 'string' ? (
          <RNText style={{ fontSize: SUB_FONT_SIZE, color: surfaceFg }} numberOfLines={1}>
            {subtitle}
          </RNText>
        ) : (
          (subtitle ?? null)
        )}
      </View>
      {action ? (
        <Toast.Action
          testID={action.testID}
          style={{ backgroundColor: surfaceFg }}
          onPress={action.onPress}>
          <Button.Label style={{ color: surfaceBg }}>{action.label}</Button.Label>
        </Toast.Action>
      ) : null}
    </ToastSlab>
  );
}
