/**
 * Reusable wrapper for modal screens with optional debug overlays.
 * Handles safe areas, scroll behavior, header gradient, sticky content.
 * Set debug={true} to see layout debug indicators.
 */

import React, { ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import {
  NativeScrollEvent,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
  SharedValue,
} from 'react-native-reanimated';
import { HeaderHeightContext } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScrollEdgeFade } from './ScrollEdgeFade';
import { Text } from '@/shared/ui/primitives/Text';
import { Log } from '@/shared/lib/logger';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { zIndex } from '@/shared/styles/tokens';

const DebugRow = ({
  label,
  value,
  color,
  fontSize = 12,
}: {
  label: string;
  value: string;
  color: string;
  fontSize?: number;
}) => (
  <View className="mb-1 flex-row justify-between">
    <Text style={{ color, fontSize }}>{label}</Text>
    <Text style={{ color, fontSize }} className="font-bold">
      {value}
    </Text>
  </View>
);

/**
 * Owns the Reanimated shared value + scroll handler for the animated-scroll
 * mode. Split out of ModalLayoutWrapper so those hooks only run when a screen
 * actually opts into animated scroll — keeping the per-mount cost off the
 * common (non-animated) modal path. Shared-value access stays inside the
 * worklet (never read/written during render), so it's React Compiler safe.
 */
function AnimatedScrollContainer({
  externalScrollY,
  contentContainerStyle,
  scrollIndicatorInsets,
  showHeaderSpacer,
  totalHeaderHeight,
  children,
}: {
  externalScrollY?: SharedValue<number>;
  contentContainerStyle: StyleProp<ViewStyle>;
  scrollIndicatorInsets?: { top?: number; right?: number; bottom?: number; left?: number };
  showHeaderSpacer: boolean;
  totalHeaderHeight: number;
  children: ReactNode;
}) {
  const internalScrollY = useSharedValue(0);
  const scrollY = externalScrollY ?? internalScrollY;

  const animatedScrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = Math.max(0, event.contentOffset.y);
    },
  });

  return (
    <Animated.ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={contentContainerStyle}
      onScroll={animatedScrollHandler}
      scrollEventThrottle={16}
      scrollIndicatorInsets={scrollIndicatorInsets}>
      {showHeaderSpacer && <View style={{ height: totalHeaderHeight }} />}
      {children}
    </Animated.ScrollView>
  );
}

interface ModalLayoutWrapperProps {
  children: ReactNode;
  /** Enable debug overlays to visualize safe areas and header height */
  debug?: boolean;
  /** Additional horizontal padding for content container (default: 16) */
  contentPadding?: number;
  /** Enable blur/gradient effect below the native header */
  headerGradient?: boolean;
  /** Custom height for the header gradient area (default: uses headerHeight) */
  headerGradientHeight?: number;
  /** Sticky content to render below the header (and gradient if enabled) */
  stickyContent?: ReactNode;
  /** Height of the sticky content for scroll padding calculation */
  stickyContentHeight?: number;
  /** Use Animated.ScrollView for scroll position tracking */
  useAnimatedScroll?: boolean;
  /** Shared value for scroll position (used with useAnimatedScroll) */
  scrollY?: SharedValue<number>;
  /** Content to render at the bottom (e.g., buttons) */
  bottomContent?: ReactNode;
  /** Bottom padding for scroll content (default: 120) */
  bottomPadding?: number;
  /**
   * When true, do not insert the automatic header spacer in the scroll content.
   * Useful when the screen hides the native header (headerShown: false) but still uses Animated.ScrollView.
   */
  disableHeaderSpacer?: boolean;
  /**
   * When true, children are rendered directly without wrapping in ScrollView.
   * Use this when you need to provide your own scrollable component (e.g., FlatList, LegendList).
   * You should add your own header spacer using the totalHeaderHeight value.
   */
  useCustomScrollView?: boolean;
  /**
   * Callback that receives the total header height (headerHeight + stickyContentHeight).
   * Useful when useCustomScrollView is true to add proper spacing to your custom scroll content.
   */
  onHeaderHeightChange?: (height: number) => void;
  /** Insets for the scroll indicator (e.g., to offset below a sticky header overlay) */
  scrollIndicatorInsets?: { top?: number; right?: number; bottom?: number; left?: number };
  /** Override the default background color (defaults to theme 'background') */
  bgColor?: string;
}

export function ModalLayoutWrapper({
  children,
  debug = false,
  contentPadding = 16,
  headerGradient = false,
  headerGradientHeight,
  stickyContent,
  stickyContentHeight = 0,
  useAnimatedScroll = false,
  scrollY: externalScrollY,
  bottomContent,
  bottomPadding = 120,
  disableHeaderSpacer = false,
  useCustomScrollView = false,
  onHeaderHeightChange,
  scrollIndicatorInsets,
  bgColor,
}: ModalLayoutWrapperProps) {
  // Read the header height context directly with a fallback so this wrapper
  // is safe to render outside a Stack navigator (e.g., AppGate renders the
  // TermsAndConditionsScreen directly during onboarding before the user has
  // entered the navigation tree). `useHeaderHeight()` throws when the
  // context is missing; we just want 0 in that case.
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const insets = useSafeAreaInsets();
  const themeBackground = useThemeColor('background');
  const background = bgColor ?? themeBackground;

  const [adjustedInsets, setAdjustedInsets] = useState({ top: 0, bottom: 0, left: 0, right: 0 });

  // The animated-scroll shared value + handler live in AnimatedScrollContainer
  // below, so every non-animated modal (the common case) doesn't pay the
  // per-mount Reanimated worklet/shared-value registration.

  const handleScroll = useCallback((event: { nativeEvent: NativeScrollEvent }) => {
    const { contentInset } = event.nativeEvent;
    if (contentInset) {
      setAdjustedInsets({
        top: contentInset.top,
        bottom: contentInset.bottom,
        left: contentInset.left,
        right: contentInset.right,
      });
    }
  }, []);

  const gradientHeight = headerGradientHeight ?? headerHeight;
  const totalHeaderHeight = headerHeight + stickyContentHeight;

  useEffect(() => {
    onHeaderHeightChange?.(totalHeaderHeight);
  }, [totalHeaderHeight, onHeaderHeightChange]);

  const shouldRenderAndroidHeaderSpacer =
    Platform.OS === 'android' && !disableHeaderSpacer && totalHeaderHeight > 0;

  const scrollContentStyle = {
    paddingHorizontal: contentPadding,
    paddingBottom: bottomPadding,
  };

  return (
    <Log name="ModalLayoutWrapper">
      <View className="flex-1" style={{ backgroundColor: background }}>
        {/* Debug-only outlines/zones. Kept off the tree entirely when not
            debugging so `react-native-screens`' `findScrollViewInFirstDescendant`
            chain finder can walk through `subviews[0]` and reach the actual
            scroll view — iOS 26's `scrollEdgeEffects` screen option only
            applies if the finder can reach the scroll view, and a leaf View
            at index 0 breaks that traversal. */}
        {debug && (
          <View
            className="absolute inset-0"
            pointerEvents="none"
            style={{ borderWidth: 2, borderColor: 'blue' }}
          />
        )}

        {headerGradient && (
          <ScrollEdgeFade edge="top" height={gradientHeight * 2} color={background} />
        )}

        {stickyContent && (
          <View style={[styles.stickyContainer, { top: headerHeight }]}>{stickyContent}</View>
        )}

        {debug && (
          <View
            className="absolute left-0 right-0 top-0 z-[100] items-center justify-end pb-1"
            style={{ height: headerHeight, backgroundColor: 'rgba(255,0,0,0.2)' }}
            pointerEvents="none">
            <Text className="text-[10px] font-bold" style={{ color: 'red' }}>
              header: {headerHeight}px
            </Text>
          </View>
        )}

        {debug && (
          <View
            className="absolute bottom-0 left-0 right-0 z-[100] items-center justify-center"
            style={{ height: insets.bottom, backgroundColor: 'rgba(0,255,255,0.3)' }}
            pointerEvents="none">
            <Text className="text-[9px] font-bold" style={{ color: 'cyan' }}>
              safe: {insets.bottom}px
            </Text>
          </View>
        )}

        {useCustomScrollView ? (
          <View style={{ flex: 1 }}>{children}</View>
        ) : useAnimatedScroll ? (
          <AnimatedScrollContainer
            externalScrollY={externalScrollY}
            contentContainerStyle={scrollContentStyle}
            scrollIndicatorInsets={scrollIndicatorInsets}
            showHeaderSpacer={!disableHeaderSpacer}
            totalHeaderHeight={totalHeaderHeight}>
            {children}
          </AnimatedScrollContainer>
        ) : (
          <ScrollView
            className="flex-1"
            contentInsetAdjustmentBehavior="automatic"
            scrollEventThrottle={16}
            onScroll={handleScroll}
            contentContainerStyle={scrollContentStyle}>
            {shouldRenderAndroidHeaderSpacer && <View style={{ height: totalHeaderHeight }} />}
            {children}
          </ScrollView>
        )}

        {bottomContent}

        {debug && (
          <View
            className="absolute right-2 rounded-lg border border-white/30 bg-black/90 p-3"
            style={{ top: headerHeight + stickyContentHeight + 8 }}
            pointerEvents="none">
            <Text className="mb-2 text-[10px] font-bold text-white">📐 Debug</Text>
            <DebugRow label="header" value={`${headerHeight}px`} color="red" fontSize={10} />
            <DebugRow label="insets.top" value={`${insets.top}px`} color="orange" fontSize={10} />
            <DebugRow
              label="insets.bottom"
              value={`${insets.bottom}px`}
              color="cyan"
              fontSize={10}
            />
            <DebugRow
              label="contentInset.top"
              value={`${adjustedInsets.top}px`}
              color="lime"
              fontSize={10}
            />
            <DebugRow
              label="contentInset.bottom"
              value={`${adjustedInsets.bottom}px`}
              color="lime"
              fontSize={10}
            />
            {headerGradient && (
              <DebugRow
                label="gradientHeight"
                value={`${gradientHeight}px`}
                color="magenta"
                fontSize={10}
              />
            )}
            {stickyContentHeight > 0 && (
              <DebugRow
                label="stickyHeight"
                value={`${stickyContentHeight}px`}
                color="yellow"
                fontSize={10}
              />
            )}
          </View>
        )}
      </View>
    </Log>
  );
}

const styles = StyleSheet.create({
  stickyContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: zIndex.dropdown,
  },
});
