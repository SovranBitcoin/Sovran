/**
 * @fileoverview Shared modal configuration for flow layouts
 *
 * This file contains shared screen options and components used by all flow layouts
 * (receive-flow, send-flow, mint-flow, transactions-flow) to ensure consistency.
 */

import { memo } from 'react';
import { Platform, View } from 'react-native';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import type { ParamListBase, NavigationProp } from '@react-navigation/native';
import { router } from 'expo-router';
import opacity from 'hex-color-opacity';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';

interface FlowColors {
  foreground: string;
  background: string;
}

/**
 * Android stand-in for the iOS header blur: a near-opaque tint of the screen
 * background. headerBlurEffect is a silent no-op on Android, which left
 * transparent headers floating over scrolling content with no scrim. Keeping
 * headerTransparent + painting headerBackground preserves each screen's
 * layout (content still lays out under the header) — flipping
 * headerTransparent off would shift everything down by the header height.
 */
const AndroidHeaderScrim = memo(function AndroidHeaderScrim({
  backgroundColor,
}: {
  backgroundColor: string;
}) {
  return <View style={{ flex: 1, backgroundColor: opacity(backgroundColor, 0.92) }} />;
});

/** Spread into header options on Android only; empty on iOS (blur handles it). */
export const androidHeaderScrimOptions = (
  backgroundColor: string
): Partial<NativeStackNavigationOptions> =>
  Platform.OS === 'android'
    ? { headerBackground: () => <AndroidHeaderScrim backgroundColor={backgroundColor} /> }
    : {};

/**
 * Shared header button component for flow layouts.
 * Shows close button on first screen, back button on subsequent screens.
 */
// Memoized so re-rendering the navigation header (which happens on any root
// re-render) doesn't re-parse the SVG icon unless isFirstScreen/foreground change.
const FlowHeaderButton = memo(function FlowHeaderButton({
  isFirstScreen,
  foreground,
}: {
  isFirstScreen: boolean;
  foreground: string;
}) {
  return (
    <ScreenHeaderAction
      icon={
        isFirstScreen ? 'material-symbols:close-rounded' : 'material-symbols:arrow-back-rounded'
      }
      color={foreground}
      onPress={() => router.back()}
    />
  );
});

/**
 * Get the base screen options for flow layouts (used inside modal stacks).
 * These options ensure consistent styling across all flow layouts.
 */
const getBaseFlowScreenOptions = (colors: FlowColors): NativeStackNavigationOptions => ({
  headerShown: true,
  headerTransparent: true,
  headerTitleAlign: 'center',
  headerStyle: {
    backgroundColor: 'transparent',
  },
  headerTitleStyle: {
    color: colors.foreground,
  },
  headerTintColor: colors.foreground,
  // Hide any back title that might show parent route names
  headerBackButtonDisplayMode: 'minimal',
  headerBackVisible: false,
  ...androidHeaderScrimOptions(colors.background),
  // Horizontal slide animation within the modal
  animation: 'slide_from_right',
  gestureEnabled: true,
  gestureDirection: 'horizontal',
  contentStyle: {
    backgroundColor: colors.background,
  },
});

/**
 * Create screen options function for flow layouts.
 * This returns a function that can be passed to Stack's screenOptions prop.
 */
export const createFlowLayoutScreenOptions = (colors: FlowColors) => {
  return ({ navigation }: { navigation: NavigationProp<ParamListBase> }) => {
    // Get the current stack index - 0 means first screen
    const state = navigation.getState();
    const isFirstScreen = state.index === 0;

    return {
      ...getBaseFlowScreenOptions(colors),
      // Dynamic back/close button based on stack depth
      headerLeft: () => (
        <FlowHeaderButton isFirstScreen={isFirstScreen} foreground={colors.foreground} />
      ),
    };
  };
};

/**
 * Base header options shared across root modal screens.
 * Used by _layout.tsx for consistent header styling.
 */
export const getBaseModalHeaderOptions = (
  foreground: string,
  backgroundColor: string
): NativeStackNavigationOptions => ({
  headerTitleAlign: 'center',
  headerTitleStyle: {
    color: foreground,
  },
  headerTintColor: foreground,
  headerBackTitleStyle: {
    fontSize: 16,
  },
  headerStyle: {
    backgroundColor,
  },
  headerLargeStyle: {
    backgroundColor,
  },
});

/**
 * Immersive variant for full-screen takeover flows (stories, fullscreen camera).
 * No header, no animation, opaque background.
 */
export const getImmersiveFlowScreenOptions = (
  backgroundColor: string
): NativeStackNavigationOptions => ({
  headerShown: false,
  contentStyle: { backgroundColor },
  animation: 'none',
});
