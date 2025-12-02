import { Text } from 'components/ui/Text';
import { View, ScrollView, NativeScrollEvent } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useCallback, ReactNode } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';

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
// - Works with formSheet, modal, and fullScreenModal presentations

export interface ModalLayoutWrapperProps {
  children: ReactNode;
  /** Enable debug overlays to visualize safe areas and header height */
  debug?: boolean;
  /** Additional padding for content container */
  contentPadding?: number;
}

export const ModalLayoutWrapper = ({
  children,
  debug = false,
  contentPadding = 16,
}: ModalLayoutWrapperProps) => {
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { getPrimaryColor } = useTheme();

  // Track iOS adjusted content insets
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

  return (
    <View className="flex-1" style={{ backgroundColor: getPrimaryColor('950') }}>
      {/* 
        LAYOUT FIX: Always render an invisible absolutely positioned element.
        This fixes a React Native quirk where scroll height breaks without it.
        The element is invisible (transparent) when debug=false, visible when debug=true.
      */}
      <View
        className="absolute inset-0"
        pointerEvents="none"
        style={{
          borderWidth: debug ? 2 : 0,
          borderColor: debug ? 'blue' : 'transparent',
        }}
      />

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

      {/* Main ScrollView */}
      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        scrollEventThrottle={16}
        onScroll={handleScroll}
        contentContainerStyle={{ paddingHorizontal: contentPadding }}>
        {children}
      </ScrollView>

      {/* Debug info panel - floating overlay */}
      {debug && (
        <View
          className="absolute right-2 rounded-lg border border-white/30 bg-black/90 p-3"
          style={{ top: headerHeight + 8 }}
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
        </View>
      )}
    </View>
  );
};

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
