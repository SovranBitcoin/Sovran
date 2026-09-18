import { Stack, DarkTheme, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { setBackgroundColorAsync } from 'expo-system-ui';
import { HeroUINativeProvider } from 'heroui-native/provider';
import 'global.css';

import { useFonts } from '@/shared/hooks/useFonts';
import { cashuLog, initLog, paymentLog, useInitMount } from '@/shared/lib/logger';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { LogBox, Platform } from 'react-native';

import AppGate from '@/shared/blocks/AppGate';
import { CtaHost } from '@/shared/blocks/CtaHost';
import GlobalMigrationGate from '@/shared/blocks/GlobalMigrationGate';
import { NativeSplashLayoutGate } from '@/shared/blocks/NativeSplashLayoutGate';
import {
  InitializationProvider,
  useInitializationReset,
} from '@/shared/providers/InitializationProvider';
import { compose } from '@/shared/lib/utils';
import { NostrKeysProvider, useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { NostrNDKProvider } from '@/shared/providers/NostrNDKProvider';
import { NostrSignerProvider } from '@/shared/providers/NostrSignerProvider';
import { PricelistProvider } from '@/shared/providers/PricelistProvider';
import { ThemeProvider, useTheme } from '@/shared/providers/ThemeProvider';
import { CapabilityProvider, useCapabilities } from '@/shared/ui/capability';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import React, { useCallback, useEffect, useMemo } from 'react';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { MODAL_SCREENS, ModalConfig } from '../config/modalScreens';
import { androidHeaderScrimOptions, getBaseModalHeaderOptions } from '../config/flowLayoutOptions';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { withGlassHeaderItems } from '@/navigation/headerItems';
import { CocoProvider } from '@/shared/providers/CocoProvider';
import { BitchatBLEProvider } from '@/shared/providers/BitchatBLEProvider';
import { WhitenoiseProvider } from '@/features/whitenoise/WhitenoiseProvider';
import { WalletContextProvider } from '@/shared/providers/WalletContextProvider';
import { HeroTransitionProvider } from '@/shared/providers/hero-transition/HeroTransitionProvider';
import { SovranColadaProvider } from '@/features/send/providers/Colada';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useAppBalance } from '@/features/wallet';
import { usePaymentStatusListener } from '@/shared/hooks/usePaymentStatusListener';
import { useSwapStatusListener } from '@/shared/hooks/useSwapStatusListener';
import { useOwnEventsSync } from '@/shared/lib/nostr/ownsync/useOwnEventsSync';
import { useOwnSocialGraphSeed } from '@/shared/lib/nostr/ownsync/useOwnSocialGraphSeed';
import PopupHost from '@/shared/blocks/popup/PopupHost';
import { ActionMenuHost } from '@/shared/blocks/popup/ActionMenuHost';
import { E2EToastProbe } from '@/shared/lib/popup/E2EToastProbe';
import { E2EStateMirror } from '@/shared/lib/e2e/E2EStateMirror';
import { AndroidImageOverlayHost } from '@/features/feed/components/nostr/image-overlay/AndroidImageOverlayHost';
import { OfflineShell, OfflineStatusProvider } from '@/shared/providers/OfflineProvider';
import {
  clearTransitionGuardOnStartup,
  registerTransitionControls,
  registerKeyDerivation,
} from '@/shared/lib/profile/profileSessionOrchestrator';

initLog('Module', '_layout loaded');

export const unstable_settings = {
  anchor: '(drawer)',
};

// Prevent splash screen from auto-hiding until fonts are loaded
void SplashScreen.preventAutoHideAsync();

initLog('_layout', 'module loaded — SplashScreen.preventAutoHideAsync called');

LogBox.ignoreAllLogs();

// Outer providers — stable across profile switches, never remount.
// InitializationProvider is first so the splash screen renders immediately
// while the blocking init stages run (avoids a blank screen gap).
// OfflineStatusProvider lives here (not inside RootLayoutContent) so the
// downstream SovranColadaProvider — which consumes useOfflineStatus() to
// drive the machine's offline send branch — actually sees real network state
// instead of the default { isOffline: false }. The visual <OfflineShell>
// stays inside RootLayoutContent and reads the same context.
const OuterProviders = compose([
  KeyboardProvider,
  InitializationProvider,
  ThemeProvider,
  CapabilityProvider,
  HeroUINativeProvider,
  HeroTransitionProvider,
  OfflineStatusProvider,
]);

// Inner providers — remounted on profile switch via React key change
function AccountScopedProviders({
  accountIndex,
  children,
}: {
  accountIndex: number;
  children: React.ReactNode;
}) {
  useInitMount('AccountScopedProviders');
  initLog('AccountScoped', `render — accountIndex=${accountIndex}`);
  useEffect(() => {
    cashuLog.info('app.account_scoped_providers.mount', { accountIndex });
    return () => {
      cashuLog.info('app.account_scoped_providers.unmount', { accountIndex });
    };
  }, [accountIndex]);
  const InnerProviders = useMemo(
    () =>
      compose([
        [NostrKeysProvider, { defaultAccountIndex: accountIndex }],
        [NostrNDKProvider, { accountIndex }],
        // NIP-46 signer service — stays cold (no sockets) until the user has
        // ≥1 connected app or an in-flight pairing. Must sit directly after
        // NostrNDKProvider: it gates on its isInitialized flag.
        NostrSignerProvider,
        [WhitenoiseProvider, { accountIndex }],
        CocoProvider,
        WalletContextProvider,
        SovranColadaProvider,
        PricelistProvider,
        // Mounts BitChat DM listeners once per account scope without
        // starting BLE on app launch. BLE discovery announces to nearby
        // bitchat clients, so explicit peer-list/chat surfaces own startup.
        BitchatBLEProvider,
        AppGate,
      ]),
    [accountIndex]
  );

  return <InnerProviders>{children}</InnerProviders>;
}

/** Registers resetStages/cancelResetStages with the orchestrator so profile transitions can show a splash. */
function TransitionControlRegistrar() {
  const { resetStages, cancelResetStages } = useInitializationReset();

  useEffect(() => {
    registerTransitionControls({ resetStages, cancelResetStages });
  }, [resetStages, cancelResetStages]);

  return null;
}

/** Registers key derivation function with the orchestrator so createAndSwitchProfile can derive keys. */
function KeyDerivationRegistrar() {
  const { getKeysForAccount } = useNostrKeysContext();

  useEffect(() => {
    registerKeyDerivation(getKeysForAccount);
  }, [getKeysForAccount]);

  return null;
}

/** Clears the AsyncStorage transition guard on app startup (if leftover from a previous restart). */
function TransitionGuardCleanup() {
  useEffect(() => {
    void clearTransitionGuardOnStartup();
  }, []);
  return null;
}

/** Subscribes to coco mint-quote events and shows payment status sheet for NPC payments */
function PaymentStatusListener() {
  useEffect(() => {
    paymentLog.info('app.payment_status_listener.mount');
    return () => {
      paymentLog.info('app.payment_status_listener.unmount');
    };
  }, []);
  usePaymentStatusListener();
  return null;
}

/** Re-pops the unified Swap toast on running→terminal transitions when the user dismissed mid-flight. */
function SwapStatusListener() {
  useEffect(() => {
    paymentLog.info('app.swap_status_listener.mount');
    return () => {
      paymentLog.info('app.swap_status_listener.unmount');
    };
  }, []);
  useSwapStatusListener();
  return null;
}

/** Invisible component that syncs the live balance to the profile store for the active profile */
function ProfileBalanceSync() {
  const balance = useAppBalance();
  const activeAccountIndex = useProfileStore((s) => s.activeAccountIndex);

  useEffect(() => {
    useProfileStore.getState().updateProfileBalance(activeAccountIndex, balance);
  }, [balance, activeAccountIndex]);

  return null;
}

/**
 * Invisible component that runs the single own-events relay sync: hydrates the
 * canonical own-state stores (profile, follows, likes, reposts, replies, own
 * notes) so they're authoritative everywhere. Subsumes the former kind-0-only
 * `ProfileMetadataSync`.
 */
function OwnEventsSync() {
  useOwnEventsSync();
  // Read-side follow seed from the tiered facade (ADR 0003); the relay sub above
  // stays the write-authoritative live-delta listener, merged via the same LWW gate.
  useOwnSocialGraphSeed();
  return null;
}

// Stable, memoized modal close button. Defined at module scope (not inside
// RootLayoutContent) so its component identity never changes between renders —
// otherwise React Navigation tears down and remounts the header's left button
// (re-parsing its SVG icon) on every root re-render.
const CloseButton = React.memo(function CloseButton() {
  return <ScreenHeaderAction icon="material-symbols:close-rounded" onPress={() => router.back()} />;
});

// Inner component that can access theme context
function RootLayoutContent() {
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
  const { keys: nostrKeys } = useNostrKeysContext();

  // Screen options builder. Memoized so unrelated root re-renders don't rebuild
  // every modal screen's options object on each render.
  const getScreenOptions = useCallback(
    (screen: ModalConfig) => {
      // Base header styling options from shared config
      const backgroundColor = nostrKeys?.pubkey ? background : 'transparent';
      const baseHeaderOptions = getBaseModalHeaderOptions(foreground, backgroundColor);

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
        });
      }

      // Default options for screens with titles (non-modal screens).
      // iOS gets a blurred transparent header; Android (where
      // headerBlurEffect is a no-op) paints a near-opaque scrim instead so
      // the title never floats unreadably over scrolling content.
      if (screen.title !== undefined) {
        return {
          ...baseHeaderOptions,
          headerShown: true,
          headerTitle: screen.title,
          ...(Platform.OS === 'ios' ? { headerBlurEffect: 'regular' as const } : {}),
          headerTransparent: true,
          headerStyle: { backgroundColor: 'transparent' },
          headerLargeStyle: { backgroundColor: 'transparent' },
          ...androidHeaderScrimOptions(background),
          headerBackTitle: 'Back',
        };
      }

      // Default: no special options
      return {};
    },
    [foreground, background, nostrKeys?.pubkey]
  );

  // For iOS 26+ with Liquid Glass, use transparent background to enable glass effects
  const { liquidGlass } = useCapabilities();
  const contentBackgroundColor = liquidGlass ? 'transparent' : background;

  // Memoize the modal screen list so it isn't rebuilt on every root re-render.
  const modalScreenElements = useMemo(
    () =>
      MODAL_SCREENS.map((screen) => (
        <Stack.Screen key={screen.name} name={screen.name} options={getScreenOptions(screen)} />
      )),
    [getScreenOptions]
  );

  return (
    <NavigationThemeProvider value={DarkTheme}>
      <KeyDerivationRegistrar />
      <PaymentStatusListener />
      <SwapStatusListener />
      <ProfileBalanceSync />
      <OwnEventsSync />
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
  const [fontsLoaded, fontError] = useFonts();
  const activeAccountIndex = useProfileStore((s) => s.activeAccountIndex);

  // Log the moment fonts finish loading — first-launch font-loading is a
  // common contributor to time-to-first-paint. In an effect, not in render:
  // a render-time ref write is impure, and the commit that makes the fonts
  // available is the moment that actually matters for paint.
  const fontsSettled = fontsLoaded || !!fontError;
  useEffect(() => {
    if (!fontsSettled) return;
    initLog('Fonts', `loaded=${fontsLoaded} error=${!!fontError}`);
  }, [fontsSettled, fontsLoaded, fontError]);

  initLog(
    'RootLayout',
    `render — fontsLoaded=${fontsLoaded} fontError=${!!fontError} account=${activeAccountIndex}`
  );

  // Don't render anything until fonts are loaded
  if (!fontsLoaded && !fontError) {
    initLog('RootLayout', 'waiting for fonts — returning null');
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Above every gate: e2e store snapshots must cover onboarding frames,
          which render before AccountScopedProviders mounts. Stores are module
          singletons, so nothing here depends on providers. */}
      <E2EStateMirror />
      <OuterProviders>
        <TransitionControlRegistrar />
        <TransitionGuardCleanup />
        <NativeSplashLayoutGate>
          <GlobalMigrationGate>
            <AccountScopedProviders
              key={`account-${activeAccountIndex}`}
              accountIndex={activeAccountIndex}>
              <RootLayoutContent />
              <E2EToastProbe />
              {/* Same-window host for the Android feed media lightbox; must
                    sit BEFORE PopupHost so popups triggered from inside the
                    lightbox stack above it. No-op on iOS / when empty. */}
              <AndroidImageOverlayHost />
              <PopupHost />
              <ActionMenuHost />
            </AccountScopedProviders>
          </GlobalMigrationGate>
        </NativeSplashLayoutGate>
      </OuterProviders>
    </GestureHandlerRootView>
  );
}
