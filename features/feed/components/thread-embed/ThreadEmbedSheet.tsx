/**
 * The collapsible thread sheet. Wraps the thread's scrollable list (and the
 * reply bar) in a `translateY`-animated surface that slides down to reveal the
 * `LinkEmbedView` behind it.
 *
 * Gesture model (active only while an embed is open):
 * - A `Gesture.Pan()` over the sheet drives `sheetTranslateY` directly.
 * - It runs `simultaneousWithExternalGesture` with a `Gesture.Native()` wrapping
 *   the list, so list scrolling and sheet dragging coexist (the gorhom recipe).
 * - The pan only moves the sheet when the list is at its top (pull-down to
 *   collapse) or when the sheet is already partway collapsed (drag to re-expand);
 *   otherwise it yields and the list scrolls normally.
 *
 * The sheet rests with its top just below the navigation header (the provider's
 * `expandedOffset`) — just above the first pfp/name — not at the screen top, and
 * is laid out down to the screen bottom so the reply bar isn't clipped. The
 * grabber is hidden until an embed is active. When no embed is active the pan is
 * disabled and the sheet rests at `translateY: 0`, so the thread behaves as
 * before (just shifted to start below the header instead of padding the list).
 *
 * The action bar is a layout-pinned sibling (in `ThreadView`) with its own pan,
 * so dragging it moves the sheet without a counter-transform breaking its
 * button hit-testing.
 */
import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  clamp,
  FadeIn,
  FadeOut,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { View } from '@/shared/ui/primitives/View/View';
import { SheetGrabber } from '@/shared/ui/composed/SheetGrabber';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { duration } from '@/shared/styles/tokens';
import { SHEET_COLLAPSED_RADIUS, SHEET_PAN_ACTIVATION, SHEET_SPRING } from './embedConstants';
import { embedHaptic } from './embedHaptics';
import { nearestSnap } from './snapMath';
import { useThreadEmbed } from './ThreadEmbedProvider';

export function ThreadEmbedSheet({
  children,
  footer,
}: {
  /** The scrollable thread list. */
  children: React.ReactNode;
  /** Pinned-bottom content (reply bar) that travels with the sheet. */
  footer?: React.ReactNode;
}) {
  const surface = useThemeColor('surface');
  const embed = useThreadEmbed();
  const embedActive = embed?.embedUrl != null;
  const startY = useSharedValue(0);

  const snapMiddle = embed?.snapMiddle ?? 0;
  const snapInline = embed?.snapInline ?? 0;
  const expandedOffset = embed?.expandedOffset ?? 0;
  const sheetTranslateY = embed?.sheetTranslateY;
  const scrollY = embed?.scrollY;
  const collapseProgress = embed?.collapseProgress;

  // Native gesture standing in for the list's scroll, so pan + scroll coexist.
  const nativeGesture = useMemo(() => Gesture.Native(), []);

  const panGesture = useMemo(() => {
    return Gesture.Pan()
      .enabled(embedActive)
      .activeOffsetY([-SHEET_PAN_ACTIVATION, SHEET_PAN_ACTIVATION])
      .simultaneousWithExternalGesture(nativeGesture)
      .onStart(() => {
        'worklet';
        if (!sheetTranslateY) return;
        startY.value = sheetTranslateY.value;
      })
      .onUpdate((e) => {
        'worklet';
        if (!sheetTranslateY || !scrollY) return;
        const expandedAtStart = startY.value <= 1;
        const atTop = scrollY.value <= 1;
        // Drag started while collapsed/mid → it controls the sheet directly.
        // Drag started expanded, at the top, pulling down → begin the collapse.
        // Otherwise the list scrolls (the provider keeps it scrollable only
        // while expanded, so the two never move together).
        if (!expandedAtStart || (atTop && e.translationY > 0)) {
          sheetTranslateY.value = clamp(startY.value + e.translationY, 0, snapInline);
        }
      })
      .onEnd((e) => {
        'worklet';
        if (!sheetTranslateY) return;
        const target = nearestSnap(sheetTranslateY.value, e.velocityY, snapMiddle, snapInline);
        if (Math.abs(target - startY.value) > 1) runOnJS(embedHaptic)();
        sheetTranslateY.value = withSpring(target, SHEET_SPRING);
      });
  }, [embedActive, nativeGesture, sheetTranslateY, scrollY, snapMiddle, snapInline, startY]);

  const sheetStyle = useAnimatedStyle(() => {
    const ty = sheetTranslateY?.value ?? 0;
    const p = collapseProgress?.value ?? 0;
    const r = interpolate(p, [0, 0.15], [0, SHEET_COLLAPSED_RADIUS], 'clamp');
    return {
      transform: [{ translateY: ty }],
      borderTopLeftRadius: r,
      borderTopRightRadius: r,
    };
  });

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        style={[styles.sheet, { top: expandedOffset, backgroundColor: surface }, sheetStyle]}>
        {embedActive ? (
          <Animated.View
            entering={FadeIn.duration(duration.standard)}
            exiting={FadeOut.duration(duration.quick)}>
            <SheetGrabber />
          </Animated.View>
        ) : null}
        <GestureDetector gesture={nativeGesture}>
          <View style={styles.listWrap}>{children}</View>
        </GestureDetector>
        {footer}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  listWrap: {
    flex: 1,
  },
});
