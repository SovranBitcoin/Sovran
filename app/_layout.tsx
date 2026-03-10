import { DarkTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { HeroUINativeProvider } from 'heroui-native/provider';
import 'global.css';
import 'intl';
import 'intl/locale-data/jsonp/en';
import 'react-native-reanimated';

import { useFonts } from '@/shared/hooks/useFonts';
import { initLog } from '@/shared/lib/initTiming';
import Icon from 'assets/icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Image, LogBox, TouchableOpacity, Platform, View } from 'react-native';
import { supportsLiquidGlass } from '@/shared/lib/version';

import AppGate from '@/shared/blocks/AppGate';
import GlobalMigrationGate from '@/shared/blocks/GlobalMigrationGate';
import LegacyMigrationGate from '@/shared/blocks/LegacyMigrationGate';
import MigrationGate from '@/shared/blocks/MigrationGate';
import {
  InitializationProvider,
  INITIALIZATION_DISPLAY_TYPE,
  useInitializationState,
  useInitializationReset,
} from '@/shared/providers/InitializationProvider';
import { ActionSheetProvider } from '@expo/react-native-action-sheet';
import { PasscodeGate } from '@/features/auth';
import { compose } from '@/shared/lib/utils';
import { NostrKeysProvider, useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { NostrNDKProvider } from '@/shared/providers/NostrNDKProvider';
import { PricelistProvider } from '@/shared/providers/PricelistProvider';
import { ThemeProvider, useTheme } from '@/shared/providers/ThemeProvider';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { persistor, store } from '@/redux/store/store.deprecated';
import { MODAL_SCREENS, ModalConfig } from '../config/modalScreens';
import { getBaseModalHeaderOptions } from '../config/flowLayoutOptions';
import { CocoProvider } from '@/shared/providers/CocoProvider';
import { HeroTransitionProvider } from '@/shared/providers/hero-transition/HeroTransitionProvider';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useAppBalance } from '@/features/wallet';
import { usePaymentStatusListener } from '@/shared/hooks/usePaymentStatusListener';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { Metadata } from 'nostr-tools/kinds';
import PopupHost from '@/shared/blocks/popup/PopupHost';
import { OfflineProvider } from '@/shared/providers/OfflineProvider';
import {
  clearTransitionGuardOnStartup,
  registerTransitionControls,
  registerKeyDerivation,
} from '@/shared/lib/profile/profileSessionOrchestrator';

export const unstable_settings = {
  initialRouteName: '(drawer)',
};

// Prevent splash screen from auto-hiding until fonts are loaded
SplashScreen.preventAutoHideAsync();

initLog('_layout', 'module loaded — SplashScreen.preventAutoHideAsync called');

LogBox.ignoreAllLogs();

const IOS_SPLASH_IMAGE_WIDTH = 390;
const REINIT_SPLASH_IMAGE = require('../assets/images/logo.png');
const REINIT_SPLASH_IMAGE_SIZE = Image.resolveAssetSource(REINIT_SPLASH_IMAGE);
const PROFILE_SWITCH_SPLASH_BOX_SIZE =
  REINIT_SPLASH_IMAGE_SIZE?.width && REINIT_SPLASH_IMAGE_SIZE?.height
    ? IOS_SPLASH_IMAGE_WIDTH * (REINIT_SPLASH_IMAGE_SIZE.height / REINIT_SPLASH_IMAGE_SIZE.width)
    : IOS_SPLASH_IMAGE_WIDTH;

// Outer providers — stable across profile switches, never remount.
// InitializationProvider is first so the splash screen renders immediately
// while PersistGate waits for Redux rehydration (avoids blank screen gap).
const OuterProviders = compose([
  KeyboardProvider,
  [InitializationProvider, { forceVisible: false }],
  [PersistGate, { loading: null, persistor }],
  [Provider, { store }],
  ThemeProvider,
  HeroUINativeProvider,
  HeroTransitionProvider,
]);

// Inner providers — remounted on profile switch via React key change
function AccountScopedProviders({
  accountIndex,
  children,
}: {
  accountIndex: number;
  children: React.ReactNode;
}) {
  initLog('AccountScoped', `render — accountIndex=${accountIndex}`);
  const InnerProviders = useMemo(
    () =>
      compose([
        MigrationGate,
        [NostrKeysProvider, { defaultAccountIndex: accountIndex }],
        [NostrNDKProvider, { accountIndex }],
        CocoProvider,
        ActionSheetProvider,
        PricelistProvider,
        PasscodeGate,
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
  usePaymentStatusListener();
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

/** Invisible component that syncs the active profile's Nostr kind-0 metadata to profileStore */
function ProfileMetadataSync() {
  const { keys: nostrKeys } = useNostrKeysContext();
  const activeAccountIndex = useProfileStore((s) => s.activeAccountIndex);

  const filters = useMemo(
    () => (nostrKeys?.pubkey ? [{ kinds: [Metadata], authors: [nostrKeys.pubkey], limit: 1 }] : []),
    [nostrKeys?.pubkey]
  );

  const { events } = useSubscribe({ filters });

  useEffect(() => {
    if (!events?.length) return;
    try {
      const parsed = JSON.parse(events[0].content);
      const displayName = parsed.display_name || parsed.name || undefined;
      const picture = parsed.picture || undefined;
      useProfileStore.getState().updateProfileMetadata(activeAccountIndex, displayName, picture);
    } catch {
      // Malformed kind-0 content — ignore
    }
  }, [events, activeAccountIndex]);

  return null;
}

// Inner component that can access theme context
function RootLayoutContent() {
  const { currentTheme } = useTheme();
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const { keys: nostrKeys } = useNostrKeysContext();

  // Close button component for modal presentations
  const CloseButton = () => (
    <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
      <Icon name="material-symbols:close-rounded" size={24} color={foreground} />
    </TouchableOpacity>
  );

  // Screen options builder
  const getScreenOptions = (screen: ModalConfig) => {
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

      return {
        ...baseHeaderOptions,
        ...screen.options,
        headerShown: true,
        ...headerStyleOverride,
        ...(screen.title !== undefined ? { headerTitle: screen.title } : {}),
        // Add close button for modal presentations (only when header is shown)
        ...(isModalPresentation ? { headerLeft: CloseButton } : {}),
      };
    }

    // Default options for screens with titles (non-modal screens)
    if (screen.title !== undefined) {
      return {
        ...baseHeaderOptions,
        headerShown: true,
        headerTitle: screen.title,
        headerBlurEffect: 'regular' as const,
        headerTransparent: true,
        headerStyle: { backgroundColor: 'transparent' },
        headerLargeStyle: { backgroundColor: 'transparent' },
        headerBackTitle: 'Back',
      };
    }

    // Default: no special options
    return {};
  };

  // For iOS 26+ with Liquid Glass, use transparent background to enable glass effects
  const useLiquidGlass = Platform.OS === 'ios' && supportsLiquidGlass();
  const contentBackgroundColor = useLiquidGlass ? 'transparent' : background;

  return (
    <NavigationThemeProvider value={DarkTheme}>
      <KeyDerivationRegistrar />
      <PaymentStatusListener />
      <ProfileBalanceSync />
      <ProfileMetadataSync />
      <StatusBar
        backgroundColor={background}
        style={currentTheme.includes('light') ? 'dark' : 'light'}
      />
      <OfflineProvider>
        <Stack
          key={currentTheme}
          screenOptions={{
            headerShown: false,
            gestureEnabled: true,
            contentStyle: {
              backgroundColor: contentBackgroundColor,
            },
          }}>
          {/* Main drawer with tabs inside */}
          <Stack.Screen name="(drawer)" options={{ headerShown: false }} />

          {/* All modal screens configured from MODAL_SCREENS */}
          {MODAL_SCREENS.map((screen) => (
            <Stack.Screen key={screen.name} name={screen.name} options={getScreenOptions(screen)} />
          ))}
        </Stack>
      </OfflineProvider>
    </NavigationThemeProvider>
  );
}

function NativeSplashLayoutGate({ children }: { children: React.ReactNode }) {
  const { isInitializing } = useInitializationState();
  const hasRootLaidOut = useRef(false);
  const hasBeenInitializing = useRef(false);
  const hasHiddenSplash = useRef(false);
  const showReinitSplash =
    INITIALIZATION_DISPLAY_TYPE === 'splash' && hasHiddenSplash.current && isInitializing;

  const maybeHideNativeSplash = useCallback(() => {
    if (INITIALIZATION_DISPLAY_TYPE !== 'splash') return;
    if (
      isInitializing ||
      !hasBeenInitializing.current ||
      !hasRootLaidOut.current ||
      hasHiddenSplash.current
    )
      return;

    hasHiddenSplash.current = true;
    initLog('NativeSplashLayoutGate', 'root laid out + init complete — hiding native splash');
    SplashScreen.hideAsync();
  }, [isInitializing]);

  const onLayoutRootView = useCallback(() => {
    hasRootLaidOut.current = true;
    maybeHideNativeSplash();
  }, [maybeHideNativeSplash]);

  useEffect(() => {
    if (isInitializing) {
      hasBeenInitializing.current = true;
    }
  }, [isInitializing]);

  useEffect(() => {
    maybeHideNativeSplash();
  }, [maybeHideNativeSplash]);

  return (
    <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
      {children}
      {showReinitSplash ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: '#000000',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 9999,
          }}>
          <Image
            source={REINIT_SPLASH_IMAGE}
            resizeMode="contain"
            style={{
              width: PROFILE_SWITCH_SPLASH_BOX_SIZE,
              height: PROFILE_SWITCH_SPLASH_BOX_SIZE,
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts();
  const activeAccountIndex = useProfileStore((s) => s.activeAccountIndex);

  initLog(
    'RootLayout',
    `render — fontsLoaded=${fontsLoaded} fontError=${!!fontError} account=${activeAccountIndex}`
  );

  // In 'splash' mode the native splash stays visible until initialization
  // finishes and the root view has produced a layout (NativeSplashLayoutGate).
  // For 'text' and 'logo' modes we hide it as soon as fonts are ready so
  // the custom React overlay can take over.
  useEffect(() => {
    if ((fontsLoaded || fontError) && INITIALIZATION_DISPLAY_TYPE !== 'splash') {
      initLog('RootLayout', 'fonts ready — calling SplashScreen.hideAsync');
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Don't render anything until fonts are loaded
  if (!fontsLoaded && !fontError) {
    initLog('RootLayout', 'waiting for fonts — returning null');
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <OuterProviders>
        <TransitionControlRegistrar />
        <TransitionGuardCleanup />
        <NativeSplashLayoutGate>
          <LegacyMigrationGate>
            <GlobalMigrationGate>
              <AccountScopedProviders
                key={`account-${activeAccountIndex}`}
                accountIndex={activeAccountIndex}>
                <RootLayoutContent />
              </AccountScopedProviders>
            </GlobalMigrationGate>
          </LegacyMigrationGate>
        </NativeSplashLayoutGate>
        <PopupHost />
      </OuterProviders>
    </GestureHandlerRootView>
  );
}
