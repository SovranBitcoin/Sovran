/**
 * @fileoverview Shared modal configuration for flow layouts
 *
 * This file contains shared screen options and components used by all flow layouts
 * (receive-flow, send-flow, mint-flow, transactions-flow) to ensure consistency.
 */

import { memo, useMemo, type ReactNode } from 'react';
import { Platform } from 'react-native';
import type { NativeStackHeaderProps, NativeStackNavigationOptions } from 'expo-router';
import type { ParamListBase, NavigationProp } from 'expo-router/react-navigation';
import { router, Stack } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { AndroidSheetRoot } from '@/shared/ui/composed/AndroidSheetRoot';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { FLOW_SHEET_HEADER_HEIGHT, FlowSheetHeader } from '@/shared/ui/composed/FlowSheetHeader';
import { AndroidHeaderScrim } from '@/shared/ui/composed/AndroidHeaderScrim';
import { withGlassHeaderItems } from '@/navigation/headerItems';

interface FlowColors {
  foreground: string;
  background: string;
}

/**
 * Spread into header options on Android only; empty on iOS (blur handles it).
 * NATIVE-header stacks only ((settings-flow)/(user-flow), root default-title
 * modals): react-navigation renders this as a content-level layer beneath the
 * natively-later toolbar, which is exactly where the fade belongs. The sheet
 * flows must NOT let this option reach native-stack — see
 * createFlowLayoutScreenOptions below.
 */
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
      // ScreenHeaderAction is AX-visible only with an accessibilityLabel; the
      // labels deliberately avoid "Close"/"Back", which in-flow content buttons
      // already use as visible text.
      accessibilityLabel={isFirstScreen ? 'Close screen' : 'Go back'}
      testID={isFirstScreen ? 'flow-header-close' : 'flow-header-back'}
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

    return withGlassHeaderItems({
      ...getBaseFlowScreenOptions(colors),
      // Sheet flows render the scrim INSIDE FlowSheetHeader and must strip the
      // headerBackground option: native-stack renders that option ITSELF in an
      // absolutely-positioned wrapper with elevation:1 (styles.translucent)
      // when headerTransparent — and on Android that elevation composites the
      // gradient ABOVE the elevation-0 custom header, covering the title and
      // headerLeft/headerRight buttons. Per-screen `headerBackground: () =>
      // null` remains the sanctioned scrim opt-out (renders nothing).
      ...(sheetHeader ? { header: renderFlowSheetHeader, headerBackground: undefined } : {}),
      // Dynamic back/close button based on stack depth
      headerLeft: () => <FlowHeaderButton isFirstScreen={isFirstScreen} />,
    });
  };
};

/**
 * Shared orchestration for modal flows presented as Android form sheets.
 * Route modules supply only their Stack.Screen declarations; theme, header,
 * sheet geometry, and stack policy stay local to this module.
 */
export function AndroidSheetFlowStack({ children }: { children: ReactNode }) {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const screenOptions = useMemo(
    () => createFlowLayoutScreenOptions({ foreground, background }, { androidSheet: true }),
    [foreground, background]
  );

  return (
    <AndroidSheetRoot headerHeight={FLOW_SHEET_HEADER_HEIGHT}>
      <Stack screenOptions={screenOptions}>{children}</Stack>
    </AndroidSheetRoot>
  );
}

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
