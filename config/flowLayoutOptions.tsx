/**
 * @fileoverview Shared modal configuration for flow layouts
 *
 * This file contains shared screen options and components used by all flow layouts
 * (receive-flow, send-flow, mint-flow, transactions-flow) to ensure consistency.
 */

import { memo } from 'react';
import { Platform } from 'react-native';
import type {
  NativeStackHeaderProps,
  NativeStackNavigationOptions,
} from '@react-navigation/native-stack';
import type { ParamListBase, NavigationProp } from '@react-navigation/native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { FlowSheetHeader } from '@/shared/ui/composed/FlowSheetHeader';

interface FlowColors {
  foreground: string;
  background: string;
}

/**
 * Android stand-in for the iOS header blur: solid background behind the bar
 * fading to transparent toward its bottom edge — a pure color gradient (no
 * blur — expo-blur on Android reads as a muddy dark tint), rendered fully
 * within the header's own bounds so it can't be clipped by the native
 * headerBackground container. The previous flat 92%-tint band ended in a hard
 * edge that looked broken over scrolling content. Keeping headerTransparent +
 * painting headerBackground preserves each screen's layout (content still
 * lays out under the header).
 */
const AndroidHeaderScrim = memo(function AndroidHeaderScrim({
  backgroundColor,
}: {
  backgroundColor: string;
}) {
  return (
    <LinearGradient
      // Solid through ~78% (title text always sits over full background),
      // easing out over the bottom ~22% of the bar.
      colors={[
        backgroundColor,
        backgroundColor,
        opacity(backgroundColor, 0.85),
        opacity(backgroundColor, 0),
      ]}
      locations={[0, 0.78, 0.9, 1]}
      style={{ flex: 1 }}
    />
  );
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
}: {
  isFirstScreen: boolean;
}) {
  return (
    <ScreenHeaderAction
      icon={
        isFirstScreen ? 'material-symbols:close-rounded' : 'material-symbols:arrow-back-rounded'
      }
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

// Module-scope so the header's component identity is stable across renders
// (same reasoning as CloseButton in app/_layout.tsx).
const renderFlowSheetHeader = (props: NativeStackHeaderProps) => <FlowSheetHeader {...props} />;

/**
 * Create screen options function for flow layouts.
 * This returns a function that can be passed to Stack's screenOptions prop.
 *
 * `androidSheet`: set by the nine MODAL flow groups, whose root screens
 * present as native Android formSheets (config/modalScreens.ts modalFlow).
 * Native headers don't render inside Android formSheets (RNS #2657), so the
 * nested stack swaps in the JS FlowSheetHeader, which interprets the same
 * per-screen options. The card-presented stacks ((settings-flow),
 * (user-flow)) must NOT set this — their native headers work.
 */
export const createFlowLayoutScreenOptions = (
  colors: FlowColors,
  config?: { androidSheet?: boolean }
) => {
  const sheetHeader = config?.androidSheet === true && Platform.OS === 'android';
  return ({ navigation }: { navigation: NavigationProp<ParamListBase> }) => {
    // Get the current stack index - 0 means first screen
    const state = navigation.getState();
    const isFirstScreen = state.index === 0;

    return {
      ...getBaseFlowScreenOptions(colors),
      ...(sheetHeader ? { header: renderFlowSheetHeader } : {}),
      // Dynamic back/close button based on stack depth
      headerLeft: () => <FlowHeaderButton isFirstScreen={isFirstScreen} />,
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
