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
import { initLog, useInitMount } from '@/shared/lib/logger';

initLog('Module', '_layout loaded');
import Icon from 'assets/icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Dimensions, Image, LogBox, StyleSheet, Platform, View } from 'react-native';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import Animated, { cubicBezier } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
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
import { ProfileWallpaperProvider } from '@/shared/providers/ProfileWallpaperProvider';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { persistor, store } from '@/redux/store/store.deprecated';
import { MODAL_SCREENS, ModalConfig } from '../config/modalScreens';
import { getBaseModalHeaderOptions } from '../config/flowLayoutOptions';
import { CocoProvider } from '@/shared/providers/CocoProvider';
import { BitchatBLEProvider } from '@/shared/providers/BitchatBLEProvider';
import { WhitenoiseProvider } from '@/features/whitenoise/WhitenoiseProvider';
import { WalletContextProvider } from '@/shared/providers/WalletContextProvider';
import { HeroTransitionProvider } from '@/shared/providers/hero-transition/HeroTransitionProvider';
import { CocoPaymentUXProvider } from '@/features/send/providers/CocoPaymentUX';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useAppBalance } from '@/features/wallet';
import { usePaymentStatusListener } from '@/shared/hooks/usePaymentStatusListener';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { Metadata } from 'nostr-tools/kinds';
import PopupHost from '@/shared/blocks/popup/PopupHost';
import { ActionMenuHost } from '@/shared/blocks/popup/ActionMenuHost';
import { OfflineProvider } from '@/shared/providers/OfflineProvider';
import {
  clearTransitionGuardOnStartup,
  registerTransitionControls,
  registerKeyDerivation,
} from '@/shared/lib/profile/profileSessionOrchestrator';
import {
  getQRButtonAnchor,
  requestQRButtonRemeasure,
  setBootMorphCompleted,
  setBootSplashHandoff,
  subscribeQRButtonAnchor,
  type QRButtonAnchor,
} from '@/shared/lib/qrButtonAnchor';

export const unstable_settings = {
  initialRouteName: '(drawer)',
};

// Prevent splash screen from auto-hiding until fonts are loaded
SplashScreen.preventAutoHideAsync();

initLog('_layout', 'module loaded — SplashScreen.preventAutoHideAsync called');

// Log when redux-persist finishes rehydration. PersistGate doesn't expose
// a callback through its composed form, so we subscribe directly. Handle
// the race where persistor is already bootstrapped by the time we subscribe.
{
  const start = Date.now();
  if (persistor.getState().bootstrapped) {
    initLog('Persistor', 'already bootstrapped at module load');
  } else {
    const unsubscribe = persistor.subscribe(() => {
      if (persistor.getState().bootstrapped) {
        initLog('Persistor', `bootstrapped durationMs=${Date.now() - start}`);
        unsubscribe();
      }
    });
  }
}

LogBox.ignoreAllLogs();

const IOS_SPLASH_IMAGE_WIDTH = 390;
const REINIT_SPLASH_IMAGE = require('../assets/images/dark-t.png');
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
  useInitMount('AccountScopedProviders');
  initLog('AccountScoped', `render — accountIndex=${accountIndex}`);
  const InnerProviders = useMemo(
    () =>
      compose([
        MigrationGate,
        ProfileWallpaperProvider,
        [NostrKeysProvider, { defaultAccountIndex: accountIndex }],
        [NostrNDKProvider, { accountIndex }],
        [WhitenoiseProvider, { accountIndex }],
        CocoProvider,
        WalletContextProvider,
        CocoPaymentUXProvider,
        ActionSheetProvider,
        PricelistProvider,
        // Starts the bitchat BLE mesh once per account scope so peers
        // populate app-wide (Split Bill picker, future "who's nearby?"
        // surfaces) without needing a chat screen open to keep the mesh
        // running. Mounted after keys/NDK so the advertised nickname is
        // derived from the active profile.
        BitchatBLEProvider,
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

const SCREEN = Dimensions.get('window');
// Splash container is square (longest screen edge × longest screen edge),
// centered. Width spills off-screen so it's invariant under uniform scale.
const SPLASH_SQUARE = Math.max(SCREEN.width, SCREEN.height);
const SPLASH_INITIAL_LEFT = (SCREEN.width - SPLASH_SQUARE) / 2;
const SPLASH_INITIAL_TOP = (SCREEN.height - SPLASH_SQUARE) / 2;
const MORPH_DURATION_MS = 750;
// `easeOutExpo` — fast initial movement, long graceful settle. Feels more
// deliberate than the default `ease-out` for the splash → QR-button morph.
// (Material Design "decelerate" / iOS-style "snappy out".)
const MORPH_TIMING = cubicBezier(0.16, 1, 0.3, 1);
const MORPH_FALLBACK_TIMEOUT = 1500; // ms to wait for QR anchor before fading
// Stability window for the QR-button anchor before kicking off the morph.
// The morph effect re-arms this timer every time the anchor changes, so
// the morph only fires once the position has been STABLE for this long.
// Combined with the polling interval below, the morph will track late
// layout shifts (iOS `contentInsetAdjustmentBehavior`, safe-area updates,
// wallpaper image load) instead of locking to an early/wrong position.
const LAYOUT_SETTLE_DELAY = 500;
// Poll cadence for `measureInWindow` during the settle window. Cheap call —
// the store dedupes redundant anchor publishes via field-level equality.
const LAYOUT_POLL_INTERVAL = 100;

function NativeSplashLayoutGate({ children }: { children: React.ReactNode }) {
  useInitMount('NativeSplashLayoutGate');
  const { isInitializing } = useInitializationState();
  const [surfaceTertiary] = useThemeColor(['surface-tertiary'] as const);
  const hasRootLaidOut = useRef(false);
  const hasBeenInitializing = useRef(false);
  const rootViewRef = useRef<View>(null);
  const splashOverlayRef = useRef<View>(null);
  const [hasHiddenSplash, setHasHiddenSplash] = useState(false);
  const [overlayMounted, setOverlayMounted] = useState(true);
  const [anchor, setAnchor] = useState<QRButtonAnchor | null>(getQRButtonAnchor());
  // Window-relative offset of the splash overlay's parent View. The QRButton
  // publishes its anchor in window coords (pageX/pageY); to position the
  // overlay at that exact spot we need to subtract our own window offset
  // (a parent View further up may not start at window (0,0)).
  const [parentOffset, setParentOffset] = useState({ x: 0, y: 0 });
  const [morphPhase, setMorphPhase] = useState<'idle' | 'morphing' | 'fading' | 'done'>(
    'idle'
  );
  const showSplash = INITIALIZATION_DISPLAY_TYPE === 'splash' && overlayMounted;

  useEffect(() => {
    const unsub = subscribeQRButtonAnchor((next) => {
      initLog('SplashMorph', `anchor published — ${next ? JSON.stringify(next) : 'null'}`);
      setAnchor(next);
    });
    return unsub;
  }, []);

  const maybeHideNativeSplash = useCallback(() => {
    if (INITIALIZATION_DISPLAY_TYPE !== 'splash') return;
    if (
      isInitializing ||
      !hasBeenInitializing.current ||
      !hasRootLaidOut.current ||
      hasHiddenSplash
    )
      return;

    setHasHiddenSplash(true);
    initLog('NativeSplashLayoutGate', 'root laid out + init complete — hiding native splash');
    SplashScreen.hideAsync();
  }, [isInitializing, hasHiddenSplash]);

  const onLayoutRootView = useCallback(() => {
    hasRootLaidOut.current = true;
    rootViewRef.current?.measureInWindow((x, y) => {
      setParentOffset((prev) => (prev.x === x && prev.y === y ? prev : { x, y }));
      initLog('SplashMorph', `parent offset measured — x=${x} y=${y}`);
    });
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

  // Reset state when init restarts (profile switch).
  useEffect(() => {
    if (!isInitializing) return;
    setBootMorphCompleted(false);
    setBootSplashHandoff(false);
    setMorphPhase('idle');
    setOverlayMounted(true);
  }, [isInitializing]);

  // Flip the global splash-handoff signal as soon as the morph (or fade)
  // begins. Destination screens listen via `useBootSplashHandoff()` to
  // time their entrance animation to overlap the splash retreat — without
  // this, an entrance triggered earlier would complete behind the still-
  // opaque splash and be invisible to the user.
  useEffect(() => {
    if (morphPhase === 'morphing' || morphPhase === 'fading') {
      setBootSplashHandoff(true);
    }
  }, [morphPhase]);

  // Kick off the morph once init is done + native splash hidden + anchor known.
  useEffect(() => {
    if (isInitializing || !hasHiddenSplash || morphPhase !== 'idle') return;

    if (anchor) {
      // Layout-settle gate: the QR button's WINDOW position changes
      // asynchronously as ancestor layout settles (iOS `contentInset
      // AdjustmentBehavior`, safe-area, wallpaper image load, etc.) — but
      // its LOCAL layout doesn't, so `onLayout` never fires for those
      // shifts. We've seen the real position arrive ~1s after the first
      // anchor publish.
      //
      // Strategy: poll `measureInWindow` (via `requestQRButtonRemeasure`)
      // every `LAYOUT_POLL_INTERVAL` ms. Each poll publishes a fresh
      // anchor; if it differs, the store notifies, this effect re-runs,
      // and the settle timer restarts. Once the position has been stable
      // for `LAYOUT_SETTLE_DELAY` ms, fire the morph.
      requestQRButtonRemeasure();
      initLog(
        'SplashMorph',
        `morph start — target=${JSON.stringify(anchor)} screen=${SCREEN.width}x${SCREEN.height}`
      );
      const poll = setInterval(requestQRButtonRemeasure, LAYOUT_POLL_INTERVAL);
      let raf = -1;
      const settle = setTimeout(() => {
        clearInterval(poll);
        requestQRButtonRemeasure();
        raf = requestAnimationFrame(() => setMorphPhase('morphing'));
      }, LAYOUT_SETTLE_DELAY);
      return () => {
        clearInterval(poll);
        clearTimeout(settle);
        if (raf !== -1) cancelAnimationFrame(raf);
      };
    }

    initLog(
      'SplashMorph',
      `init done but no anchor yet — waiting up to ${MORPH_FALLBACK_TIMEOUT}ms`
    );
    const fallback = setTimeout(() => {
      const latest = getQRButtonAnchor();
      if (latest) {
        initLog('SplashMorph', `late anchor — morphing to ${JSON.stringify(latest)}`);
        setAnchor(latest);
        setMorphPhase('morphing');
      } else {
        initLog('SplashMorph', 'no anchor — fading out');
        setMorphPhase('fading');
      }
    }, MORPH_FALLBACK_TIMEOUT);
    return () => clearTimeout(fallback);
  }, [isInitializing, hasHiddenSplash, anchor, morphPhase]);

  // CSS transitions don't fire a callback in Reanimated 4 — time it off the
  // same duration the transition uses. When the morph ends, reveal the
  // QRButton (it fades in at the same position).
  useEffect(() => {
    if (morphPhase !== 'morphing' && morphPhase !== 'fading') return;
    const id = setTimeout(() => {
      // Measure where the splash overlay actually landed, in window coords,
      // so we can compare against the QR button's measured position.
      const node = splashOverlayRef.current as unknown as {
        measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void;
      } | null;
      node?.measureInWindow?.((x, y, w, h) => {
        initLog(
          'SplashMorph',
          `final overlay rect (window) — x=${x} y=${y} width=${w} height=${h}`
        );
      });
      setBootMorphCompleted(true);
      setMorphPhase('done');
    }, MORPH_DURATION_MS + 30);
    return () => clearTimeout(id);
  }, [morphPhase]);

  // Hold the splash overlay one short beat after the QRButton has faded in,
  // then unmount it so the real button takes over.
  useEffect(() => {
    if (morphPhase !== 'done') return;
    const id = setTimeout(() => setOverlayMounted(false), 200);
    return () => clearTimeout(id);
  }, [morphPhase]);

  const isMorphing = morphPhase === 'morphing' || morphPhase === 'done';
  const isFading = morphPhase === 'fading' || morphPhase === 'done';

  // Build the splash container style. Reanimated 4 CSS Transitions tween the
  // listed properties on the UI thread whenever their values change.
  // The container stays opaque white throughout — only the logo/icon and the
  // optional gradient layer cross-fade on top.
  const overlayStyle = useMemo(() => {
    const base = {
      position: 'absolute' as const,
      backgroundColor: '#FFFFFF',
      // Match the QRButton's `borderCurve: 'continuous'` (squircle) so the
      // morphed corners line up pixel-for-pixel with the real button at
      // handoff. iOS-only — Android falls back to standard arc which the
      // Android QRButton also uses.
      borderCurve: 'continuous' as const,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      overflow: 'hidden' as const,
      zIndex: 9999,
      transitionProperty: ['top', 'left', 'width', 'height', 'borderRadius', 'opacity'],
      transitionDuration: `${MORPH_DURATION_MS}ms`,
      transitionTimingFunction: MORPH_TIMING,
    };

    if (isMorphing && anchor) {
      const finalTop = anchor.y - parentOffset.y;
      const finalLeft = anchor.x - parentOffset.x;
      initLog(
        'SplashMorph',
        `target rect (parent-local) — top=${finalTop} left=${finalLeft} width=${anchor.width} height=${anchor.height} borderRadius=${anchor.borderRadius} | anchor(window)={x:${anchor.x},y:${anchor.y}} parentOffset={x:${parentOffset.x},y:${parentOffset.y}}`
      );
      return {
        ...base,
        top: finalTop,
        left: finalLeft,
        width: anchor.width,
        height: anchor.height,
        borderRadius: anchor.borderRadius,
        opacity: 1,
      };
    }
    return {
      ...base,
      top: SPLASH_INITIAL_TOP - parentOffset.y,
      left: SPLASH_INITIAL_LEFT - parentOffset.x,
      width: SPLASH_SQUARE,
      height: SPLASH_SQUARE,
      borderRadius: 0,
      opacity: isFading ? 0 : 1,
    };
  }, [isMorphing, isFading, anchor, parentOffset]);

  // Logo: fades + scales down during the morph so it doesn't bulge out of the
  // shrinking container. Lives inside the morph container, so it's already
  // riding the transition; we just dial opacity + scale via CSS transitions.
  const logoStyle = useMemo(
    () => ({
      width: PROFILE_SWITCH_SPLASH_BOX_SIZE,
      height: PROFILE_SWITCH_SPLASH_BOX_SIZE,
      opacity: isMorphing ? 0 : 1,
      transform: [{ scale: isMorphing ? 0.18 : 1 }],
      transitionProperty: ['opacity', 'transform'],
      transitionDuration: `${MORPH_DURATION_MS * 0.7}ms`,
      transitionTimingFunction: MORPH_TIMING,
    }),
    [isMorphing]
  );

  // Cross-fade layers — container stays solid white. A subtle white →
  // off-white gradient overlay fades in during the morph so the bottom of
  // the splash matches the QR button's slight downward shading. Logo fades
  // out and the QR icon fades in (delayed) so the swap to the real button
  // is invisible.
  const gradientLayerStyle = useMemo(
    () => ({
      ...StyleSheet.absoluteFillObject,
      opacity: isMorphing ? 1 : 0,
      transitionProperty: ['opacity'],
      transitionDuration: `${MORPH_DURATION_MS * 0.85}ms`,
      transitionTimingFunction: MORPH_TIMING,
    }),
    [isMorphing]
  );

  const qrIconLayerStyle = useMemo(
    () => ({
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      opacity: isMorphing ? 1 : 0,
      transitionProperty: ['opacity'],
      transitionDuration: `${MORPH_DURATION_MS * 0.6}ms`,
      transitionDelay: `${MORPH_DURATION_MS * 0.35}ms`,
      transitionTimingFunction: MORPH_TIMING,
    }),
    [isMorphing]
  );

  return (
    <View
      ref={rootViewRef}
      collapsable={false}
      style={{ flex: 1, overflow: 'hidden' }}
      onLayout={onLayoutRootView}>
      {children}
      {showSplash ? (
        <Animated.View ref={splashOverlayRef} pointerEvents="none" style={overlayStyle}>
          {/* QR-button look-alike layered background. Replicates the exact
              stack the real QRButton uses (dark base + white-overlay + white
              top-to-bottom gradient + faint white border) so when the splash
              docks at the QR position and unmounts, the pixel handoff to
              the real button is seamless.
              Boot state: opacity 0 (the container's solid white shows through);
              morph state: opacity 1 (matches the QR gradient). */}
          <Animated.View pointerEvents="none" style={gradientLayerStyle}>
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#0f0f12' }]} />
            <View
              style={[
                StyleSheet.absoluteFillObject,
                { backgroundColor: 'rgba(255,255,255,0.35)' },
              ]}
            />
            <LinearGradient
              colors={[
                '#FFFFFF',
                'rgba(255,255,255,0.8)',
                'rgba(255,255,255,0.7)',
                'rgba(255,255,255,0.6)',
              ]}
              locations={[0, 0.35, 0.6, 1]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
            <View
              style={[
                StyleSheet.absoluteFillObject,
                { borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
              ]}
            />
          </Animated.View>
          {/* Splash logo. Fades + scales out during morph. */}
          <Animated.Image source={REINIT_SPLASH_IMAGE} resizeMode="contain" style={logoStyle} />
          {/* QR icon. Fades in (delayed) so it's visible by the time the
              swap happens to the real button. */}
          <Animated.View pointerEvents="none" style={qrIconLayerStyle}>
            <Icon
              name="stash:qr-code"
              size={Platform.OS === 'ios' ? 38 : 24}
              color={surfaceTertiary}
            />
          </Animated.View>
        </Animated.View>
      ) : null}
    </View>
  );
}

export default function RootLayout() {
  useInitMount('RootLayout');
  const [fontsLoaded, fontError] = useFonts();
  const activeAccountIndex = useProfileStore((s) => s.activeAccountIndex);

  // Log the moment fonts finish loading — first-launch font-loading is a
  // common contributor to time-to-first-paint.
  const fontsReadyLogged = useRef(false);
  if ((fontsLoaded || fontError) && !fontsReadyLogged.current) {
    fontsReadyLogged.current = true;
    initLog('Fonts', `loaded=${fontsLoaded} error=${!!fontError}`);
  }

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
                <PopupHost />
                <ActionMenuHost />
              </AccountScopedProviders>
            </GlobalMigrationGate>
          </LegacyMigrationGate>
        </NativeSplashLayoutGate>
      </OuterProviders>
    </GestureHandlerRootView>
  );
}
