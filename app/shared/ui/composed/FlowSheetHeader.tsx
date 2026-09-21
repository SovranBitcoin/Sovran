import { useState, type ComponentProps } from 'react';
/**
 * JS header for nested flow stacks presented as Android formSheets.
 *
 * react-native-screens renders no native header inside an Android formSheet
 * (RNS #2657), so the flow `_layout`s opt into the react-navigation custom
 * `header` option on Android (createFlowLayoutScreenOptions androidSheet).
 * native-stack then renders this component above screen content (absolutely
 * positioned when headerTransparent), measures it into HeaderHeightContext
 * (useHeaderHeight() consumers keep working), and skips it entirely for
 * headerShown:false screens.
 *
 * It interprets the SAME per-screen options the native header would have —
 * headerLeft/headerRight/headerTitle/title/headerStyle — so screens need no
 * changes. Visuals match FormSheetChrome (grabber + centered bold title +
 * equal-width side slots).
 *
 * The header OWNS the Android scrim (HeaderGradient) rather than reading
 * it from options.headerBackground: createFlowLayoutScreenOptions strips that
 * option on sheet flows because native-stack renders it ITSELF in a wrapper
 * with elevation:1 when headerTransparent — on Android that composites the
 * gradient ABOVE this (elevation-0) header, covering the title and buttons.
 * Flow-sheet screens must not set a NON-null per-screen headerBackground;
 * doing so re-triggers that elevated duplicate. `headerBackground: () => null`
 * is the sanctioned per-screen scrim OPT-OUT (used by the profile screen,
 * whose banner the scrim would cover) — the elevated wrapper mounts but
 * renders nothing.
 *
 * Deliberately ignored options (iOS/native-only): headerBackButtonMenuEnabled,
 * headerBlurEffect, headerBackVisible, headerLargeStyle, header shadows. The
 * back/close affordance is the flows' own headerLeft (FlowHeaderButton).
 * No top safe-area inset — the sheet already sits below the status bar.
 */
import Animated from 'react-native-reanimated';
import { StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import type { NativeStackHeaderProps } from 'expo-router';
import { HEADER_TITLE_MIN_WIDTH } from '@/navigation/headerLayout';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { headerButtonSize, spacing, fontSize } from '@/shared/styles/tokens';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { SheetGrabber } from '@/shared/ui/composed/SheetGrabber';
import { HeaderGradient } from '@/shared/ui/composed/HeaderGradient';

/**
 * Fixed total height: SheetGrabber (8 marginTop + 4) + title row
 * (headerButtonSize content + 4×2 padding) = 74 on Android. Fixed (not min)
 * so native-stack's measured HeaderHeightContext is a stable constant —
 * sheet content must not shift when the default header height settles to
 * the measured one. Custom headerTitle components must fit within the
 * headerButtonSize row.
 */
export const FLOW_SHEET_HEADER_HEIGHT = 12 + headerButtonSize + spacing.xs * 2;

/** Scrim gradient height: the bar plus a ~32dp eased fade tail painting
 *  below it over scrolling content. */
export const SCRIM_TOTAL_HEIGHT = FLOW_SHEET_HEADER_HEIGHT + 32;

/** How far the scrim's eased fade tail overhangs below the measured bar. The
 *  absolute scrim doesn't feed HeaderHeightContext, so content/sticky insets
 *  must add this back or the first row sits under the fade at rest (Android
 *  formSheets only). */
export const FLOW_SHEET_SCRIM_OVERHANG = SCRIM_TOTAL_HEIGHT - FLOW_SHEET_HEADER_HEIGHT;

export function FlowSheetHeader({
  back,
  options,
  route,
  appearance = 'gradient',
  gradientStyle,
}: NativeStackHeaderProps & {
  appearance?: 'gradient' | 'opaque' | 'gradient-tabs';
  gradientStyle?: ComponentProps<typeof Animated.View>['style'];
}) {
  const [foreground, background] = useThemeColor(['foreground', 'surface'] as const);

  const tintColor = options.headerTintColor ?? foreground;
  const titleColor =
    (StyleSheet.flatten(options.headerTitleStyle) as { color?: string } | undefined)?.color ??
    tintColor;

  const titleText =
    typeof options.headerTitle === 'string' ? options.headerTitle : (options.title ?? route.name);

  const title =
    typeof options.headerTitle === 'function' ? (
      options.headerTitle({ children: titleText, tintColor })
    ) : (
      <Text bold size={fontSize.xl} numberOfLines={1} style={{ color: titleColor }}>
        {titleText}
      </Text>
    );

  const left = options.headerLeft?.({ tintColor, canGoBack: !!back });
  const right = options.headerRight?.({ tintColor, canGoBack: !!back });

  // Both slots reserve the WIDER side's measured width. A flex title between
  // unequal slots is centred in the space left over, not on the sheet: two
  // actions against one shifted it by half the difference. The mirror stops
  // where it would squeeze the title below HEADER_TITLE_MIN_WIDTH (three actions
  // on a narrow sheet); past that the title keeps its room and gives up the centre.
  const { width: sheetWidth } = useWindowDimensions();
  const [leftWidth, setLeftWidth] = useState(0);
  const [rightWidth, setRightWidth] = useState(0);
  const mirrorLimit = (sheetWidth - spacing.sm * 2 - HEADER_TITLE_MIN_WIDTH) / 2;
  const sideSlotWidth = {
    minWidth: Math.max(headerButtonSize, Math.min(Math.max(leftWidth, rightWidth), mirrorLimit)),
  };
  const measureLeft = (event: LayoutChangeEvent) => setLeftWidth(event.nativeEvent.layout.width);
  const measureRight = (event: LayoutChangeEvent) => setRightWidth(event.nativeEvent.layout.width);

  // Screen declares its page color here on Android sheets. Native iOS bars
  // stay transparent; this custom header owns the Android gradient.
  const headerStyleBackground = (
    StyleSheet.flatten(options.headerStyle) as { backgroundColor?: string } | undefined
  )?.backgroundColor;
  const declaredBackground =
    headerStyleBackground && headerStyleBackground !== 'transparent'
      ? headerStyleBackground
      : undefined;

  // A screen-provided null background opts out for immersive media.
  // All ordinary sheets get the gradient in their declared page color.
  // The scrim is TALLER than the bar: solid through the title row, then an
  // eased fade whose tail paints ~32dp below the bar over scrolling content.
  // Safe because native-stack's custom-header wrapper has no overflow clip
  // and absolute children don't contribute to the onLayout that feeds
  // HeaderHeightContext (the measured height stays FLOW_SHEET_HEADER_HEIGHT).
  const backgroundLayer =
    appearance === 'gradient-tabs' ? null : appearance === 'opaque' ? (
      <View style={[styles.container, { backgroundColor: declaredBackground ?? background }]} />
    ) : options.headerBackground ? (
      options.headerBackground()
    ) : (
      <HeaderGradient
        backgroundColor={declaredBackground ?? background}
        height={SCRIM_TOTAL_HEIGHT}
        anchor={FLOW_SHEET_HEADER_HEIGHT / SCRIM_TOTAL_HEIGHT - 0.1}
      />
    );

  return (
    <View style={styles.container}>
      {backgroundLayer ? (
        <Animated.View style={[styles.backgroundLayer, gradientStyle]} pointerEvents="none">
          {backgroundLayer}
        </Animated.View>
      ) : null}
      <SheetGrabber />
      <HStack align="center" style={styles.titleRow}>
        <View style={[styles.sideSlot, sideSlotWidth]}>
          <View onLayout={measureLeft}>{left}</View>
        </View>
        <View style={styles.titleSlot}>{title}</View>
        <View style={[styles.sideSlot, styles.rightSlot, sideSlotWidth]}>
          <View onLayout={measureRight}>{right}</View>
        </View>
      </HStack>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: FLOW_SHEET_HEADER_HEIGHT,
  },
  // Taller than the container (fade tail below the bar) — overflow stays
  // default-visible; pointerEvents none so it can't intercept touches.
  backgroundLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: SCRIM_TOTAL_HEIGHT,
  },
  titleRow: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: headerButtonSize,
  },
  // Min-width (not fixed) so wide headerRight content (e.g. mint list's
  // inspect Link) isn't clipped. Content hugs its own edge so the measured
  // width is the content's, never the slot's.
  sideSlot: {
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  rightSlot: {
    alignItems: 'flex-end',
  },
  titleSlot: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
