import React, { useState, useCallback, ReactNode, useEffect } from 'react';
import { Text } from 'components/ui/Text';
import { View, ScrollView, NativeScrollEvent, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedScrollHandler,
  SharedValue,
} from 'react-native-reanimated';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';

// =============================================================================
// DEBUG ROW COMPONENT
// =============================================================================

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

// =============================================================================
// MODAL LAYOUT WRAPPER
// =============================================================================
// Reusable wrapper for modal screens with optional debug overlays.
// - Handles safe areas and scroll behavior automatically
// - Set debug={true} to see layout debug indicators
// - Set headerGradient={true} to add blur/gradient effect below header
// - Set stickyContent to add a sticky element below the header
// - Set useAnimatedScroll={true} with scrollY for animated scroll tracking
// - Works with formSheet, modal, and fullScreenModal presentations

export interface ModalLayoutWrapperProps {
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
}

export const ModalLayoutWrapper = ({
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
  useCustomScrollView = false,
  onHeaderHeightChange,
}: ModalLayoutWrapperProps) => {
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { getPrimaryColor } = useTheme();

  // Internal scroll tracking for debug mode
  const [adjustedInsets, setAdjustedInsets] = useState({ top: 0, bottom: 0, left: 0, right: 0 });

  // Internal scroll value if not provided externally
  const internalScrollY = useSharedValue(0);
  const scrollY = externalScrollY ?? internalScrollY;

  // Animated scroll handler for Animated.ScrollView
  const animatedScrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = Math.max(0, event.contentOffset.y);
    },
  });

  // Regular scroll handler for debug tracking
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

  // Notify parent of header height changes
  useEffect(() => {
    onHeaderHeightChange?.(totalHeaderHeight);
  }, [totalHeaderHeight, onHeaderHeightChange]);

  // Scroll content container style
  const scrollContentStyle = {
    paddingHorizontal: contentPadding,
    paddingBottom: bottomPadding,
  };

  return (
    <View className="flex-1" style={{ backgroundColor: getPrimaryColor('950') }}>
      {/* 
        LAYOUT FIX: Always render an invisible absolutely positioned element.
        This fixes a React Native quirk where scroll height breaks without it.
      */}
      <View
        className="absolute inset-0"
        pointerEvents="none"
        style={{
          borderWidth: debug ? 2 : 0,
          borderColor: debug ? 'blue' : 'transparent',
        }}
      />

      {/* Header gradient with blur effect - positioned at top */}
      {headerGradient && (
        <View
          style={[styles.headerGradientContainer, { height: gradientHeight * 2 }]}
          pointerEvents="none">
          <MaskedView
            style={StyleSheet.absoluteFill}
            maskElement={
              <LinearGradient
                colors={['black', 'black', 'transparent']}
                locations={[0, 0.5, 1]}
                style={StyleSheet.absoluteFill}
              />
            }>
            <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
            <LinearGradient
              colors={[getPrimaryColor('950'), 'transparent']}
              locations={[0.5, 1]}
              style={StyleSheet.absoluteFill}
            />
          </MaskedView>
        </View>
      )}

      {/* Sticky content below header */}
      {stickyContent && (
        <View style={[styles.stickyContainer, { top: headerHeight }]}>{stickyContent}</View>
      )}

      {/* Header height indicator (red) - only visible in debug mode */}
      <View
        className="absolute left-0 right-0 top-0 z-[100] items-center justify-end pb-1"
        style={{
          height: headerHeight,
          backgroundColor: debug ? 'rgba(255,0,0,0.2)' : 'transparent',
        }}
        pointerEvents="none">
        {debug && (
          <Text className="text-[10px] font-bold" style={{ color: 'red' }}>
            header: {headerHeight}px
          </Text>
        )}
      </View>

      {/* Bottom safe area indicator (cyan) - only visible in debug mode */}
      <View
        className="absolute bottom-0 left-0 right-0 z-[100] items-center justify-center"
        style={{
          height: insets.bottom,
          backgroundColor: debug ? 'rgba(0,255,255,0.3)' : 'transparent',
        }}
        pointerEvents="none">
        {debug && (
          <Text className="text-[9px] font-bold" style={{ color: 'cyan' }}>
            safe: {insets.bottom}px
          </Text>
        )}
      </View>

      {/* Main content - either custom scroll, Animated ScrollView, or regular ScrollView */}
      {useCustomScrollView ? (
        // Custom scroll view mode - render children directly, consumer handles scrolling
        <View style={{ flex: 1 }}>{children}</View>
      ) : useAnimatedScroll ? (
        <Animated.ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={scrollContentStyle}
          onScroll={animatedScrollHandler}
          scrollEventThrottle={16}>
          {/* Header spacer */}
          <View style={{ height: totalHeaderHeight }} />
          {children}
        </Animated.ScrollView>
      ) : (
        <ScrollView
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          scrollEventThrottle={16}
          onScroll={handleScroll}
          contentContainerStyle={scrollContentStyle}>
          {children}
        </ScrollView>
      )}

      {/* Bottom content (e.g., buttons) */}
      {bottomContent}

      {/* Debug info panel - floating overlay */}
      {debug && (
        <View
          className="absolute right-2 rounded-lg border border-white/30 bg-black/90 p-3"
          style={{ top: headerHeight + stickyContentHeight + 8 }}
          pointerEvents="none">
          <Text className="mb-2 text-[10px] font-bold text-white">📐 Debug</Text>
          <DebugRow label="header" value={`${headerHeight}px`} color="red" fontSize={10} />
          <DebugRow label="insets.top" value={`${insets.top}px`} color="orange" fontSize={10} />
          <DebugRow label="insets.bottom" value={`${insets.bottom}px`} color="cyan" fontSize={10} />
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
  );
};

const styles = StyleSheet.create({
  headerGradientContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
  },
  stickyContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 99,
  },
});

// =============================================================================
// DEBUG MODAL SCREEN
// =============================================================================

export default function DebugModal() {
  const { getPrimaryColor } = useTheme();
  const params = useLocalSearchParams<{ itemId?: string; debug?: string }>();
  const itemId = params.itemId ?? 'unknown';
  const showDebug = params.debug === 'true';

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: `Item ${itemId}`,
          headerTitleStyle: { color: getPrimaryColor('0') },
          headerTintColor: getPrimaryColor('0'),
        }}
      />
      <ModalLayoutWrapper debug={showDebug}>
        {/* Item details card */}
        <View className="mb-4 rounded-xl border border-white/20 bg-white/10 p-4">
          <Text className="mb-2 text-lg font-bold text-white">Item Details</Text>
          <Text className="text-white/70">You tapped on Item {itemId}</Text>
          {showDebug && <Text className="mt-2 text-xs text-yellow-400">Debug mode: ON</Text>}
        </View>

        {/* Example content rows */}
        <View className="gap-3">
          {Array.from({ length: 10 }, (_, i) => (
            <View key={i} className="rounded-lg border border-white/20 bg-white/10 p-4">
              <Text className="text-white">Modal Content Row {i + 1}</Text>
            </View>
          ))}
        </View>
      </ModalLayoutWrapper>
    </>
  );
}
