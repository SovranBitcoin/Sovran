/**
 * The app root: everything that outlives an account.
 *
 * Starts the headless `appRuntime` for the process, applies the theme, and
 * mounts the third-party root adapters (gestures, keyboard, safe-area insets)
 * and the review overlays. Below it, the splash and migration gates hold the account
 * scope until fonts, the native layout and the global migrations are done.
 * Nothing here remounts on a profile switch.
 */
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaListener } from 'react-native-safe-area-context';
import { Uniwind } from 'uniwind';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { useFonts } from '@/shared/hooks/useFonts';
import { IS_E2E_LOG_BUILD, initLog } from '@/shared/lib/logger';
import { E2EStateMirror } from '@/shared/lib/e2e/E2EStateMirror';
import GlobalMigrationGate from '@/shared/blocks/GlobalMigrationGate';
import { NativeSplashLayoutGate } from '@/shared/blocks/NativeSplashLayoutGate';
import { CapabilityProvider } from '@/shared/ui/capability';
import { LayoutGuides } from '@/shared/ui/composed/LayoutGuides';
import { TouchIndicatorEnabled, TouchIndicatorLayer } from '@/shared/ui/composed/TouchIndicator';
import { HeroTransitionProvider } from '@/shared/providers/hero-transition/HeroTransitionProvider';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { appRuntime } from './AppRuntime';
import { useThemeApplier } from './theme';

/**
 * Process-level state that renders: the theme (the app waits for it), the
 * layout guides and the touch indicators. The end-to-end test build always
 * draws touches: its recordings should show where each tap landed, and its
 * runner waits on the entry a drawn touch logs.
 */
function ProcessChrome({ children }: { children: React.ReactNode }) {
  const themeReady = useThemeApplier();
  const guides = useSettingsStore((s) => s.layoutGuides);
  const showTouches = useSettingsStore((s) => s.showTouches) || IS_E2E_LOG_BUILD;
  // The process services start with the first themed render, where the
  // providers that used to own them mounted.
  useEffect(() => (themeReady ? appRuntime.startProcess() : undefined), [themeReady]);
  if (!themeReady) return null;
  return (
    <View className="flex-1">
      <CapabilityProvider>
        <TouchIndicatorEnabled.Provider value={showTouches}>
          {/* The outermost layer covers whatever is not inside a screen, a
              sheet or a popup of its own (the wallet home, tab bar, drawer). */}
          <TouchIndicatorLayer>
            {/* Feeds the native insets to Uniwind so `*-safe*` classes resolve
                (`pb-safe-offset-5` and friends). The SafeAreaProvider is
                expo-router's. */}
            <SafeAreaListener onChange={({ insets }) => Uniwind.updateInsets(insets)}>
              <HeroTransitionProvider>{children}</HeroTransitionProvider>
            </SafeAreaListener>
          </TouchIndicatorLayer>
        </TouchIndicatorEnabled.Provider>
        <LayoutGuides enabled={guides} />
      </CapabilityProvider>
    </View>
  );
}

export function AppRoot({ children }: { children: React.ReactNode }) {
  const [fontsLoaded, fontError] = useFonts();

  // Log the moment fonts finish loading — first-launch font-loading is a
  // common contributor to time-to-first-paint. In an effect, not in render:
  // the commit that makes the fonts available is the moment that matters.
  const fontsSettled = fontsLoaded || !!fontError;
  useEffect(() => {
    if (!fontsSettled) return;
    initLog('Fonts', `loaded=${fontsLoaded} error=${!!fontError}`);
  }, [fontsSettled, fontsLoaded, fontError]);

  // Don't render anything until fonts are loaded.
  if (!fontsSettled) {
    initLog('RootLayout', 'waiting for fonts — returning null');
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Above every gate: e2e store snapshots must cover onboarding frames,
          which render before the account scope mounts. Stores are module
          singletons, so nothing here depends on providers. */}
      <E2EStateMirror />
      <KeyboardProvider>
        <ProcessChrome>
          <NativeSplashLayoutGate>
            <GlobalMigrationGate>{children}</GlobalMigrationGate>
          </NativeSplashLayoutGate>
        </ProcessChrome>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
