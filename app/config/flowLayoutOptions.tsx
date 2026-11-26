import { GRADIENT_HEADER_OPTIONS } from '@/navigation/headerOptions';
/**
 * @fileoverview The four flow stacks' shared stack and header
 *
 * `(send-flow)`, `(receive-flow)`, `(mint-flow)` and `(settings-flow)` are the
 * only nested stacks: a task whose steps push inside one sheet on iPhone (or
 * one pushed page for Settings) and inside one pushed screen on Android. Every
 * other route is a root route (config/modalScreens.ts). All four draw the
 * native header on both platforms.
 */

import { PICKER_SHEET_OPTIONS } from './modalScreens';
import { memo, useMemo, type ReactNode } from 'react';
import { Platform } from 'react-native';
import type { NativeStackNavigationOptions } from 'expo-router';
import type { ParamListBase, NavigationProp } from 'expo-router/react-navigation';
import { Stack } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
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
   * The flow is a pushed screen (Android, and Settings everywhere), not a
   * sheet. Leaving a pushed screen is going back, so its first screen shows
   * the arrow too; an X says "dismiss this sheet". Selectors and labels are
   * unchanged either way.
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

/**
 * The mint selector, when a flow pushes it over another screen: the picker
 * sheet (`PICKER_SHEET_OPTIONS`) on iPhone, a pushed page on Android. As the
 * first screen of a flow there is nothing to rise over, and the stack shows it
 * as an ordinary page.
 */
/** Route names that use the options below, for the header's close button. */
const IOS_SHEET_SCREENS: ReadonlySet<string> = new Set(['mintSelect']);

export const MINT_SELECT_SCREEN_OPTIONS: NativeStackNavigationOptions = {
  ...PICKER_SHEET_OPTIONS,
  title: 'Select mint',
};

/**
 * Screen options for a flow stack, for Stack's `screenOptions`: the shared
 * header, with the close button on the first screen and back after it.
 */
const createFlowLayoutScreenOptions = (colors: FlowColors, pushedEverywhere: boolean) => {
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
      // Dynamic back/close button based on stack depth
      headerLeft: () => (
        <FlowHeaderButton
          isFirstScreen={isFirstScreen}
          pushed={pushedEverywhere || Platform.OS === 'android'}
          sheet={Platform.OS === 'ios' && !isFirstScreen && IOS_SHEET_SCREENS.has(route.name)}
        />
      ),
    });
  };
};

/**
 * The stack a flow group's `_layout` renders: themed, with the shared header.
 * Route modules supply only their Stack.Screen declarations.
 *
 * `pushed`: the group is a pushed page on every platform (`slideFromRight` in
 * config/modalScreens.ts — Settings), never an iPhone sheet, so its first
 * screen goes back with the arrow instead of closing with the X.
 */
export function FlowStack({ children, pushed = false }: { children: ReactNode; pushed?: boolean }) {
  const [foreground, background] = useThemeColor(['foreground', 'surface'] as const);
  const screenOptions = useMemo(
    () => createFlowLayoutScreenOptions({ foreground, background }, pushed),
    [foreground, background, pushed]
  );
  return <Stack screenOptions={screenOptions}>{children}</Stack>;
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
