import { GRADIENT_HEADER_OPTIONS } from '@/navigation/headerOptions';
/**
 * @fileoverview Shared modal configuration for flow layouts
 *
 * This file contains shared screen options and components used by all flow layouts
 * (receive-flow, send-flow, mint-flow, transactions-flow) to ensure consistency.
 */

import { androidFlowPresentation } from './androidFlowPresentation';
import { memo, useMemo, type ReactNode } from 'react';
import { Platform } from 'react-native';
import type { NativeStackHeaderProps, NativeStackNavigationOptions } from 'expo-router';
import type { ParamListBase, NavigationProp } from 'expo-router/react-navigation';
import { Stack } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { AndroidSheetRoot, SheetPageLayer } from '@/shared/ui/composed/AndroidSheetRoot';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { FLOW_SHEET_HEADER_HEIGHT, FlowSheetHeader } from '@/shared/ui/composed/FlowSheetHeader';
import { withGlassHeaderItems } from '@/navigation/headerItems';

interface FlowColors {
  foreground: string;
  background: string;
}

/**
 * Shared header button component for flow layouts.
 * Shows close button on first screen, back button on subsequent screens.
 */
// Memoized so re-rendering the navigation header (which happens on any root
// re-render) doesn't re-parse the SVG icon unless isFirstScreen/foreground change.
const FlowHeaderButton = memo(function FlowHeaderButton({
  isFirstScreen,
  pushed,
  sheet = false,
}: {
  isFirstScreen: boolean;
  /**
   * This one screen rose as a system sheet over the screen before it (iPhone
   * mint selector). It is dismissed, not gone back from, so it shows the X.
   * The selector stays `flow-header-back`: the route is the same.
   */
  sheet?: boolean;
  /**
   * The flow is a pushed screen (Android), not a sheet. Leaving a pushed
   * screen is going back, so its first screen shows the arrow too; an X says
   * "dismiss this sheet". Selectors and labels are unchanged either way.
   */
  pushed: boolean;
}) {
  return (
    <ScreenHeaderAction
      icon={
        sheet || (isFirstScreen && !pushed)
          ? 'material-symbols:close-rounded'
          : 'material-symbols:arrow-back-rounded'
      }
      // ScreenHeaderAction is AX-visible only with an accessibilityLabel; the
      // labels deliberately avoid "Close"/"Back", which in-flow content buttons
      // already use as visible text.
      accessibilityLabel={isFirstScreen || sheet ? 'Close screen' : 'Go back'}
      testID={isFirstScreen ? 'flow-header-close' : 'flow-header-back'}
      onPress={() => router.back()}
    />
  );
});

/**
 * The native title in the type a page's own `headerTitle` draws (`Text size={16}
 * bold`). Pages that set a custom title do it from inside the screen, so the
 * native one shows for the first frames of every push; in the system font it
 * read as the title changing its letters when the custom one took over.
 */
const NATIVE_TITLE_FONT = { fontFamily: 'OxygenBold', fontSize: 16 } as const;

/**
 * Get the base screen options for flow layouts (used inside modal stacks).
 * These options ensure consistent styling across all flow layouts.
 */
const getBaseFlowScreenOptions = (colors: FlowColors): NativeStackNavigationOptions => ({
  headerShown: true,
  ...GRADIENT_HEADER_OPTIONS,
  headerTitleAlign: 'center',
  headerTitleStyle: {
    color: colors.foreground,
    ...NATIVE_TITLE_FONT,
  },
  headerTintColor: colors.foreground,
  // Hide any back title that might show parent route names
  headerBackButtonDisplayMode: 'minimal',
  headerBackVisible: false,
  headerBackground: () => null,
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

// Each page renders as a sibling of FlowSheetHeader; isolating it keeps its
// zIndex layers (edge fades, sticky rows) under the header's title and buttons.
const renderSheetPageLayer = ({ children }: { children: ReactNode }) => (
  <SheetPageLayer>{children}</SheetPageLayer>
);

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
/**
 * The mint selector, when a flow pushes it over another screen.
 *
 * On iPhone it is a system sheet: it rises over the amount screen at a little
 * over half height, shows a grabber, grows to full height when pulled or
 * scrolled, and is dismissed by pulling down. Choosing a mint is a short
 * detour from the screen underneath, and a sheet keeps that screen in view.
 * As the first screen of a flow there is nothing to rise over, and the stack
 * shows it as an ordinary page.
 *
 * Android keeps the pushed page (ADR 0025).
 */
/** Route names that use the options below, for the header's close button. */
const IOS_SHEET_SCREENS: ReadonlySet<string> = new Set(['mintSelect']);

export const MINT_SELECT_SCREEN_OPTIONS: NativeStackNavigationOptions =
  Platform.OS === 'ios'
    ? {
        title: 'Select mint',
        presentation: 'formSheet',
        sheetAllowedDetents: [0.62, 1],
        sheetGrabberVisible: true,
        sheetCornerRadius: 28,
        sheetExpandsWhenScrolledToEdge: true,
      }
    : { title: 'Select mint' };

export const createFlowLayoutScreenOptions = (
  colors: FlowColors,
  config?: { androidSheet?: boolean }
) => {
  const sheetHeader = config?.androidSheet === true && Platform.OS === 'android';
  return ({
    navigation,
    route,
  }: {
    navigation: NavigationProp<ParamListBase>;
    route: { name: string };
  }) => {
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
      headerLeft: () => (
        <FlowHeaderButton
          isFirstScreen={isFirstScreen}
          pushed={Platform.OS === 'android' && !sheetHeader}
          sheet={Platform.OS === 'ios' && !isFirstScreen && IOS_SHEET_SCREENS.has(route.name)}
        />
      ),
    });
  };
};

/**
 * Shared orchestration for modal flows presented as Android form sheets.
 * Route modules supply only their Stack.Screen declarations; theme, header,
 * sheet geometry, and stack policy stay local to this module.
 */
export function AndroidSheetFlowStack({
  flow,
  children,
}: {
  /** The route group this stack belongs to, e.g. `(send-flow)`. */
  flow: string;
  children: ReactNode;
}) {
  const [foreground, background] = useThemeColor(['foreground', 'surface'] as const);
  // Android only: a sheet flow draws the JS sheet header inside a fixed-height
  // sheet frame; a pushed flow is an ordinary stack with the native header.
  const androidSheet = Platform.OS === 'android' && androidFlowPresentation(flow) === 'sheet';
  const screenOptions = useMemo(
    () => createFlowLayoutScreenOptions({ foreground, background }, { androidSheet }),
    [foreground, background, androidSheet]
  );

  if (Platform.OS === 'android' && !androidSheet) {
    return <Stack screenOptions={screenOptions}>{children}</Stack>;
  }

  return (
    <AndroidSheetRoot headerHeight={FLOW_SHEET_HEADER_HEIGHT}>
      <Stack
        screenOptions={screenOptions}
        screenLayout={Platform.OS === 'android' ? renderSheetPageLayer : undefined}>
        {children}
      </Stack>
    </AndroidSheetRoot>
  );
}

/**
 * Base header options shared across root modal screens.
 * Used by _layout.tsx for consistent header styling.
 */
export const getBaseModalHeaderOptions = (foreground: string): NativeStackNavigationOptions => ({
  headerTitleAlign: 'center',
  headerTitleStyle: {
    color: foreground,
    ...NATIVE_TITLE_FONT,
  },
  headerTintColor: foreground,
  headerBackTitleStyle: {
    fontSize: 16,
  },
  ...GRADIENT_HEADER_OPTIONS,
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
