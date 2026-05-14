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

import { supportsBlur } from '@/shared/lib/version';

import { LoadingIndicator, type Phase, type Result } from '@/shared/blocks/status';

import { useToastSurface } from './useToastSurface';
import { DANGER_DARK_BG, SUCCESS_DARK_BG, TINT_ALPHA, ToastSlab } from './ToastSlab';

const ICON_SIZE = 32;
const TITLE_FONT_SIZE = 15;
const SUB_FONT_SIZE = 13;
const TERMINAL_TINT_DURATION_MS = 800;
const AUTO_DISMISS_MS = 3000;

export type StatusToastStatus = 'pending' | 'delivered' | 'confirmed' | 'failed';

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
  action?: { label: string; onPress: () => void };
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
 * the theme surface to success or danger when `status` flips to a terminal
 * value (`'confirmed'` or `'failed'`); 3 seconds later the toast manager is
 * told to hide. `'pending'` and `'delivered'` are non-terminal and keep the
 * toast visible until the caller flips status or unmounts the component.
 */
export function StatusToast({ status, title, subtitle, action, toastProps }: StatusToastProps) {
  const { bg: surfaceBg, fg: surfaceFg } = useToastSurface();
  const blurSupported = supportsBlur();
  const surfaceBgTint = blurSupported ? opacity(surfaceBg, TINT_ALPHA) : surfaceBg;

  const isTerminal = status === 'confirmed' || status === 'failed';
  const targetBg = status === 'failed' ? DANGER_DARK_BG : SUCCESS_DARK_BG;
  const targetBgTint = blurSupported ? opacity(targetBg, TINT_ALPHA) : targetBg;

  const indicatorPhase: Phase = isTerminal ? 'done' : 'loading';
  const indicatorResult: Result = status === 'failed' ? 'error' : 'success';

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
    const timer = setTimeout(() => hide(), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [isTerminal, hide]);

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
        size={ICON_SIZE}
        phase={indicatorPhase}
        result={indicatorResult}
        color={surfaceFg}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <RNText
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
        <Toast.Action style={{ backgroundColor: surfaceFg }} onPress={action.onPress}>
          <Button.Label style={{ color: surfaceBg }}>{action.label}</Button.Label>
        </Toast.Action>
      ) : null}
    </ToastSlab>
  );
}
