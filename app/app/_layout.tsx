import { Stack, DarkTheme, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { setBackgroundColorAsync } from 'expo-system-ui';
import 'global.css';
import { initLog, useInitMount } from '@/shared/lib/logger';
import { LogBox, Platform } from 'react-native';
import { CtaHost } from '@/shared/blocks/CtaHost';
import { OfflineShell } from '@/shared/blocks/OfflineShell';
import { useTheme } from '@/runtime/theme';
import { AppRoot } from '@/runtime/AppRoot';
import { AccountScope, AccountSwitchBoundary } from '@/runtime/AccountScope';
import { useCapabilities } from '@/shared/ui/capability';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import React, { useCallback, useEffect, useMemo } from 'react';
import { MODAL_SCREENS, ModalConfig } from '../config/modalScreens';
import { getBaseModalHeaderOptions } from '../config/flowLayoutOptions';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { loadSettledHeaderHeights } from '@/shared/ui/composed/settledHeaderHeight';
import { applyFeatureSetToWallet } from '@/shared/config/features';
import { useFeatureRouteGuard } from '@/shared/lib/nav/featureRoutes';
import { preloadNfcSupported } from '@/shared/lib/nfc/useNfcSupported';
import { withGlassHeaderItems } from '@/navigation/headerItems';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { isSheetEntry } from '@/shared/lib/nav/profileRoutes';

initLog('Module', '_layout loaded');

export const unstable_settings = {
  anchor: '(drawer)',
};

// Prevent splash screen from auto-hiding until fonts are loaded
void SplashScreen.preventAutoHideAsync();

initLog('_layout', 'module loaded — SplashScreen.preventAutoHideAsync called');

LogBox.ignoreAllLogs();
// Before any stack pushes a page, so it starts at the right header height.
void loadSettledHeaderHeights();
// Before Send opens, so its method list is sized by the answer, not the guess.
applyFeatureSetToWallet();
preloadNfcSupported();

// Stable, memoized modal close button. Defined at module scope (not inside
// RootLayoutContent) so its component identity never changes between renders —
// otherwise React Navigation tears down and remounts the header's left button
// (re-parsing its SVG icon) on every root re-render.
const CloseButton = React.memo(function CloseButton() {
  return <ScreenHeaderAction icon="material-symbols:close-rounded" onPress={() => router.back()} />;
});

// A pushed Android route leaves with Back; same chrome as every header action.
const BackButton = React.memo(function BackButton() {
  return (
    <ScreenHeaderAction
      icon="material-symbols:arrow-back-rounded"
      accessibilityLabel="Go back"
      testID="flow-header-back"
      onPress={() => router.back()}
    />
  );
});

// The route stack: the drawer, the not-found catch-all and every modal screen.
function RootLayoutContent() {
  useFeatureRouteGuard();
  const { currentTheme } = useTheme();
  const [foreground, background] = useThemeColor(['foreground', 'surface'] as const);

  // SDK 56: Android is edge-to-edge and expo-status-bar dropped the
  // backgroundColor prop. Set the window background (shown THROUGH the
  // translucent status bar) to the theme background so the status-bar area
  // matches the app and doesn't flash on theme/profile switch. No-op on iOS.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void setBackgroundColorAsync(background);
  }, [background]);

  // Screen options builder. Memoized so unrelated root re-renders don't rebuild
  // every modal screen's options object on each render.
  const getScreenOptions = useCallback(
    (screen: ModalConfig) => {
      // Base header styling options from shared config
      const baseHeaderOptions = getBaseModalHeaderOptions(foreground);

      // Check if this is a modal/formSheet presentation
      const isModalPresentation =
        screen.options?.presentation === 'modal' || screen.options?.presentation === 'formSheet';

      // If headerShown is explicitly false, the nested layout handles headers
      // Don't add any header-related options
      if (screen.options?.headerShown === false) {
        return {
          ...screen.options,
          // Ensure no header-related options leak through
          headerBackButtonDisplayMode: 'minimal' as const,
        };
      }

      // If the screen has explicit options, merge with base options
      if (screen.options) {
        // If headerTransparent is true, use transparent background to avoid opaque header
        const headerStyleOverride = screen.options.headerTransparent
          ? {
              headerStyle: { backgroundColor: 'transparent' },
              headerLargeStyle: { backgroundColor: 'transparent' },
            }
          : {};

        return withGlassHeaderItems({
          ...baseHeaderOptions,
          ...screen.options,
          headerShown: true,
          ...headerStyleOverride,
          ...(screen.title !== undefined ? { headerTitle: screen.title } : {}),
          // Add close button for modal presentations (only when header is shown)
          ...(isModalPresentation ? { headerLeft: () => <CloseButton /> } : {}),
          ...(screen.androidPushed
            ? { headerLeft: () => <BackButton />, headerBackVisible: false }
            : {}),
        });
      }

      // Page-owned gradients sit behind the native title and actions.
      if (screen.title !== undefined) {
        return {
          ...baseHeaderOptions,
          headerShown: true,
          headerTitle: screen.title,
          headerBlurEffect: 'none' as const,
          headerTransparent: true,
          headerStyle: { backgroundColor: 'transparent' },
          headerLargeStyle: { backgroundColor: 'transparent' },
          headerBackTitle: 'Back',
        };
      }

      // Default: no special options
      return {};
    },
    [foreground]
  );

  // For iOS 26+ with Liquid Glass, use transparent background to enable glass effects
  const { liquidGlass } = useCapabilities();
  const contentBackgroundColor = liquidGlass ? 'transparent' : background;

  // Memoize the modal screen list so it isn't rebuilt on every root re-render.
  const modalScreenElements = useMemo(
    () =>
      MODAL_SCREENS.map((screen) => {
        const options = getScreenOptions(screen);
        if (!screen.sheet) {
          return <Stack.Screen key={screen.name} name={screen.name} options={options} />;
        }
        // Opened from a sheet (`entry=sheet`), the page is a sheet too.
        const sheetOptions = getScreenOptions({ name: screen.name, ...screen.sheet });
        return (
          <Stack.Screen
            key={screen.name}
            name={screen.name}
            options={({ route }) => (isSheetEntry(route.params) ? sheetOptions : options)}
          />
        );
      }),
    [getScreenOptions]
  );

  return (
    <NavigationThemeProvider value={DarkTheme}>
      {/* SDK 56: expo-status-bar removed the (Android-only) backgroundColor prop. */}
      <StatusBar style={currentTheme.includes('light') ? 'dark' : 'light'} />
      <OfflineShell>
        <Stack
          // NOTE: deliberately NOT keyed on the theme. The old key={currentTheme}
          // remounted the ENTIRE navigator on every theme change — acceptable
          // when themes changed from a settings screen, but the account
          // carousel now changes the theme on every swipe, and the remount
          // (WalletScreen unmount→mount, history refetch, carousel reset) was
          // the post-switch jitter (log evidence: lifecycle.unmount
          // WalletScreen 110ms before every wallet.layout.shift burst).
          // screenOptions below stays reactive — native-stack re-applies
          // contentStyle to mounted screens when options identity changes.
          screenOptions={{
            headerShown: false,
            gestureEnabled: true,
            // Stop the covered drawer/tab tree from re-rendering under a modal.
            freezeOnBlur: true,
            contentStyle: {
              backgroundColor: contentBackgroundColor,
            },
          }}>
          {/* Main drawer with tabs inside */}
          <Stack.Screen name="(drawer)" options={{ headerShown: false }} />

          {/* Catch-all for unresolved routes — degrades gracefully instead of
              leaving the user on a dead screen. */}
          <Stack.Screen name="+not-found" options={{ headerShown: false }} />

          {/* All modal screens configured from MODAL_SCREENS */}
          {modalScreenElements}
        </Stack>
        <CtaHost />
      </OfflineShell>
    </NavigationThemeProvider>
  );
}

export default function RootLayout() {
  useInitMount('RootLayout');
  const activeAccountIndex = useProfileStore((s) => s.activeAccountIndex);
  initLog('RootLayout', `render — account=${activeAccountIndex}`);

  return (
    <AppRoot>
      <AccountSwitchBoundary>
        <AccountScope key={`account-${activeAccountIndex}`} accountIndex={activeAccountIndex}>
          <RootLayoutContent />
        </AccountScope>
      </AccountSwitchBoundary>
    </AppRoot>
  );
}
