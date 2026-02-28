import { AnimatedBackgroundView } from 'components/ui/BackgroundView';
import { useBackgroundConfig } from 'providers/BackgroundProvider';
import { Text } from 'components/ui/Text';
import {
  View,
  ScrollView,
  LayoutChangeEvent,
  NativeScrollEvent,
  Platform,
  Pressable,
  RefreshControlProps,
} from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Rect } from 'react-native-svg';
import { useState, useCallback, ReactNode } from 'react';
import { router } from 'expo-router';

// =============================================================================
// CONSTANTS
// =============================================================================

// iOS native tab bar heights (Apple HIG):
// - iPhone standard: 49pt
// - iPhone floating pill style (iOS 18+): ~56pt (visual height with padding)
// - iPad: 50pt
// - Android: 56pt
const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? (Platform.isPad ? 50 : 56) : 56;

// =============================================================================
// INSET BORDER COMPONENT (SVG stroke renders inside bounds)
// =============================================================================

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
// LAYOUT DEBUG WRAPPER
// =============================================================================

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
  contentContainerStyle?: object;
  /**
   * Callback when content size changes (useful for ScrollableGradientOverlay)
   * Only called when scrollable=true
   */
  onContentSizeChange?: (width: number, height: number) => void;
  /**
   * Optional RefreshControl for pull-to-refresh (only used when scrollable=true)
   */
  refreshControl?: React.ReactElement<RefreshControlProps>;
}

export const LayoutDebugWrapper = ({
  children,
  debug = false,
  scrollable = true,
  contentContainerStyle = { padding: 16 },
  onContentSizeChange,
  refreshControl,
}: LayoutDebugWrapperProps) => {
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  // Track iOS adjusted content insets (via contentInsetAdjustmentBehavior)
  const [adjustedInsets, setAdjustedInsets] = useState({ top: 0, bottom: 0, left: 0, right: 0 });

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

  const actualBottomInset = adjustedInsets.bottom;
  const estimatedBottomArea = TAB_BAR_HEIGHT + insets.bottom;
  const bottomArea = actualBottomInset > 0 ? actualBottomInset : estimatedBottomArea;

  // Debug overlays component
  const renderDebugOverlays = () => {
    if (!debug) return null;

    return (
      <>
        {/* Container border (blue) */}
        <InsetBorder color="blue" />

        {/* Header height indicator (red) */}
        <View
          className="absolute left-0 right-0 top-0 z-[100] items-center justify-end pb-1"
          style={{ height: headerHeight, backgroundColor: 'rgba(255,0,0,0.2)' }}>
          <InsetBorder color="red" />
          <Text className="text-[10px] font-bold" style={{ color: 'red' }}>
            headerHeight: {headerHeight}px
          </Text>
        </View>

        {/* Safe area top indicator (orange) */}
        <View
          className="absolute left-0 top-0 z-[101] w-full items-center justify-center"
          style={{ height: insets.top, backgroundColor: 'rgba(255,165,0,0.3)' }}>
          <InsetBorder color="orange" />
          <Text className="text-[8px] font-bold" style={{ color: 'orange' }}>
            top: {insets.top}
          </Text>
        </View>

        {/* Tab bar + safe area indicator (magenta) */}
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

        {/* Safe area bottom indicator (cyan) */}
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

  // Debug info card component
  const renderDebugInfoCard = () => {
    if (!debug) return null;

    return (
      <View className="mb-4 rounded-xl border border-white/20 bg-black/85 p-4">
        <Text className="mb-3 text-sm font-bold text-white">Layout Debug</Text>

        {/* TOP */}
        <Text className="mb-1.5 text-[10px] text-neutral-500">TOP</Text>
        <DebugRow label="Safe Area Top" value={`${insets.top}px`} color="orange" />
        <DebugRow label="Header Height" value={`${headerHeight}px`} color="red" />
        <View className="h-2" />

        {/* BOTTOM */}
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

        {/* SIDES */}
        <Text className="mb-1.5 text-[10px] text-neutral-500">SIDES</Text>
        <DebugRow
          label="Left / Right"
          value={`${insets.left}px / ${insets.right}px`}
          color="gray"
        />
        <View className="h-2" />

        {/* iOS CONTENT INSET */}
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

  // Non-scrollable mode: render children directly in a flex container
  if (!scrollable) {
    return (
      <AnimatedBackgroundView>
        {renderDebugOverlays()}
        <View className="flex-1">{children}</View>
      </AnimatedBackgroundView>
    );
  }

  // Scrollable mode: wrap in ScrollView with automatic content inset adjustment
  return (
    <AnimatedBackgroundView>
      {renderDebugOverlays()}

      {/* Main ScrollView with automatic content inset adjustment */}
      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        scrollEventThrottle={16}
        onScroll={debug ? handleScroll : undefined}
        onContentSizeChange={onContentSizeChange}
        contentContainerStyle={contentContainerStyle}
        refreshControl={refreshControl}>
        {renderDebugInfoCard()}

        {/* Actual content */}
        {children}
      </ScrollView>
    </AnimatedBackgroundView>
  );
};

// =============================================================================
// EXAMPLE SCREEN
// =============================================================================

const ExampleScreen = () => {
  useBackgroundConfig({ blurMode: 'full' });

  const handleItemPress = (itemId: number, debug = false) => {
    router.navigate({
      pathname: '/debugModal',
      params: { itemId: String(itemId), debug: String(debug) },
    });
  };

  return (
    <LayoutDebugWrapper debug={true}>
      {/* Your actual screen content goes here */}
      {/* First item opens with debug mode */}
      <Pressable
        onPress={() => handleItemPress(1, true)}
        className="mb-3 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-4 active:opacity-70">
        <Text className="font-bold text-yellow-400">Item 1 (Debug Mode)</Text>
      </Pressable>

      {/* Rest open without debug */}
      {Array.from({ length: 19 }, (_, i) => (
        <Pressable
          key={i + 2}
          onPress={() => handleItemPress(i + 2)}
          className="mb-3 rounded-lg border border-white/20 bg-white/10 p-4 active:opacity-70">
          <Text>Item {i + 2}</Text>
        </Pressable>
      ))}
    </LayoutDebugWrapper>
  );
};

export default ExampleScreen;
