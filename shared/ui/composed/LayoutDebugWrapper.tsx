import React, { ReactNode, useCallback, useState } from 'react';
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  Platform,
  RefreshControlProps,
  ScrollView,
  ScrollViewProps,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Rect } from 'react-native-svg';

import { AnimatedBackgroundView } from '@/shared/ui/composed/BackgroundView';
import { Log } from '@/shared/lib/logger';
import { Text } from '@/shared/ui/primitives/Text';

// iOS native tab bar heights (Apple HIG):
// - iPhone standard: 49pt; floating pill (iOS 18+): ~56pt; iPad: 50pt; Android: 56pt
const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? (Platform.isPad ? 50 : 56) : 56;

const InsetBorder = ({ color, strokeWidth = 2 }: { color: string; strokeWidth?: number }) => {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
  };
  return (
    <View className="absolute inset-0" pointerEvents="none" onLayout={onLayout}>
      {size.width > 0 && size.height > 0 && (
        <Svg width={size.width} height={size.height}>
          <Rect
            x={strokeWidth / 2}
            y={strokeWidth / 2}
            width={size.width - strokeWidth}
            height={size.height - strokeWidth}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
          />
        </Svg>
      )}
    </View>
  );
};

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

interface LayoutDebugWrapperProps {
  children: ReactNode;
  /**
   * Enable debug overlays showing safe areas and insets
   * @default false
   */
  debug?: boolean;
  /**
   * When true, wraps children in a ScrollView with automatic content inset adjustment.
   * Set to false for screens with PagerView or custom scroll handling.
   * @default true
   */
  scrollable?: boolean;
  /**
   * Custom content container style for the ScrollView (only used when scrollable=true)
   * @default { padding: 16 }
   */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /**
   * Callback when content size changes (useful for ScrollableGradientOverlay)
   * Only called when scrollable=true
   */
  onContentSizeChange?: (width: number, height: number) => void;
  /**
   * Optional RefreshControl for pull-to-refresh (only used when scrollable=true)
   */
  refreshControl?: React.ReactElement<RefreshControlProps>;
  onScrollBeginDrag?: ScrollViewProps['onScrollBeginDrag'];
  onScrollEndDrag?: ScrollViewProps['onScrollEndDrag'];
  /** Scroll passthrough (merged with the internal debug inset tracker). */
  onScroll?: ScrollViewProps['onScroll'];
}

export function LayoutDebugWrapper({
  children,
  debug = false,
  scrollable = true,
  contentContainerStyle = { padding: 16 },
  onContentSizeChange,
  refreshControl,
  onScrollBeginDrag,
  onScrollEndDrag,
  onScroll,
}: LayoutDebugWrapperProps) {
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [adjustedInsets, setAdjustedInsets] = useState({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  });

  const handleScroll = useCallback(
    (event: { nativeEvent: NativeScrollEvent }) => {
      if (debug) {
        const { contentInset } = event.nativeEvent;
        if (contentInset) {
          setAdjustedInsets({
            top: contentInset.top,
            bottom: contentInset.bottom,
            left: contentInset.left,
            right: contentInset.right,
          });
        }
      }
      onScroll?.(event as Parameters<NonNullable<ScrollViewProps['onScroll']>>[0]);
    },
    [debug, onScroll]
  );

  const actualBottomInset = adjustedInsets.bottom;
  const estimatedBottomArea = TAB_BAR_HEIGHT + insets.bottom;
  const bottomArea = actualBottomInset > 0 ? actualBottomInset : estimatedBottomArea;
  const flattenedContentStyle = StyleSheet.flatten(contentContainerStyle) ?? {};
  const baseTopPadding =
    typeof flattenedContentStyle.paddingTop === 'number'
      ? flattenedContentStyle.paddingTop
      : typeof flattenedContentStyle.paddingVertical === 'number'
        ? flattenedContentStyle.paddingVertical
        : typeof flattenedContentStyle.padding === 'number'
          ? flattenedContentStyle.padding
          : 0;
  const scrollContentStyle =
    Platform.OS === 'android' && headerHeight > 0
      ? [contentContainerStyle, { paddingTop: baseTopPadding + headerHeight }]
      : contentContainerStyle;

  const renderDebugOverlays = () => {
    if (!debug) return null;
    return (
      <>
        <InsetBorder color="blue" />
        <View
          className="absolute left-0 right-0 top-0 z-[100] items-center justify-end pb-1"
          style={{ height: headerHeight, backgroundColor: 'rgba(255,0,0,0.2)' }}>
          <InsetBorder color="red" />
          <Text className="text-[10px] font-bold" style={{ color: 'red' }}>
            headerHeight: {headerHeight}px
          </Text>
        </View>
        <View
          className="absolute left-0 top-0 z-[101] w-full items-center justify-center"
          style={{ height: insets.top, backgroundColor: 'rgba(255,165,0,0.3)' }}>
          <InsetBorder color="orange" />
          <Text className="text-[8px] font-bold" style={{ color: 'orange' }}>
            top: {insets.top}
          </Text>
        </View>
        <View
          className="absolute bottom-0 left-0 right-0 z-[99] items-center justify-start pt-1"
          style={{ height: bottomArea, backgroundColor: 'rgba(255,0,255,0.25)' }}>
          <InsetBorder color="magenta" strokeWidth={3} />
          <Text className="text-[10px] font-bold" style={{ color: 'magenta' }}>
            Tab Bar Area: {bottomArea}px
          </Text>
          <Text className="text-[8px]" style={{ color: 'magenta' }}>
            ({TAB_BAR_HEIGHT}px tab + {insets.bottom}px safe)
          </Text>
        </View>
        <View
          className="absolute bottom-0 left-0 right-0 z-[100] items-center justify-center"
          style={{ height: insets.bottom, backgroundColor: 'rgba(0,255,255,0.3)' }}>
          <InsetBorder color="cyan" />
          <Text className="text-[9px] font-bold" style={{ color: 'cyan' }}>
            Safe Area: {insets.bottom}px
          </Text>
        </View>
      </>
    );
  };

  const renderDebugInfoCard = () => {
    if (!debug) return null;
    return (
      <View className="mb-4 rounded-xl border border-white/20 bg-black/85 p-4">
        <Text className="mb-3 text-sm font-bold text-white">Layout Debug</Text>
        <Text className="mb-1.5 text-[10px] text-neutral-500">TOP</Text>
        <DebugRow label="Safe Area Top" value={`${insets.top}px`} color="orange" />
        <DebugRow label="Header Height" value={`${headerHeight}px`} color="red" />
        <View className="h-2" />
        <Text className="mb-1.5 text-[10px] text-neutral-500">BOTTOM</Text>
        <DebugRow label="Safe Area Bottom" value={`${insets.bottom}px`} color="cyan" />
        <DebugRow label="Tab Bar Constant" value={`${TAB_BAR_HEIGHT}px`} color="yellow" />
        <DebugRow label="Estimated Total" value={`${estimatedBottomArea}px`} color="magenta" />
        <DebugRow
          label="iOS Actual (scroll)"
          value={actualBottomInset > 0 ? `${actualBottomInset}px` : '—'}
          color="lime"
        />
        <View className="h-2" />
        <Text className="mb-1.5 text-[10px] text-neutral-500">SIDES</Text>
        <DebugRow
          label="Left / Right"
          value={`${insets.left}px / ${insets.right}px`}
          color="gray"
        />
        <View className="h-2" />
        <Text className="mb-1.5 text-[10px] text-neutral-500">iOS CONTENT INSET</Text>
        <DebugRow
          label="contentInset.top"
          value={`${adjustedInsets.top}px`}
          color="lime"
          fontSize={11}
        />
        <DebugRow
          label="contentInset.bottom"
          value={`${adjustedInsets.bottom}px`}
          color="lime"
          fontSize={11}
        />
      </View>
    );
  };

  if (!scrollable) {
    return (
      <Log name="LayoutDebugWrapper">
        <AnimatedBackgroundView>
          {renderDebugOverlays()}
          <View className="flex-1">{children}</View>
        </AnimatedBackgroundView>
      </Log>
    );
  }

  return (
    <Log name="LayoutDebugWrapper">
      <AnimatedBackgroundView>
        {renderDebugOverlays()}
        <ScrollView
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          scrollEventThrottle={16}
          onScroll={debug || onScroll ? handleScroll : undefined}
          onScrollBeginDrag={onScrollBeginDrag}
          onScrollEndDrag={onScrollEndDrag}
          onContentSizeChange={onContentSizeChange}
          contentContainerStyle={scrollContentStyle}
          refreshControl={refreshControl}>
          {renderDebugInfoCard()}
          {children}
        </ScrollView>
      </AnimatedBackgroundView>
    </Log>
  );
}
