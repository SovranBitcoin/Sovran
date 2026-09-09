import { Stack, DarkTheme, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { setBackgroundColorAsync } from 'expo-system-ui';
import { HeroUINativeProvider } from 'heroui-native/provider';
import 'global.css';
import Animated from 'react-native-reanimated';

import { useFonts } from '@/shared/hooks/useFonts';
import { cashuLog, initLog, paymentLog, useInitMount } from '@/shared/lib/logger';
import Icon from 'assets/icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Dimensions, Image, LogBox, Platform, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import AppGate from '@/shared/blocks/AppGate';
import GlobalMigrationGate from '@/shared/blocks/GlobalMigrationGate';
import {
  InitializationProvider,
  useInitializationState,
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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  getQRButtonAnchor,
  getWalletTabFocused,
  requestQRButtonRemeasure,
  setBootMorphCompleted,
  setBootSplashHandoff,
  shouldFastForwardBootOverlay,
  subscribeQRButtonAnchor,
  subscribeWalletTabFocused,
  type QRButtonAnchor,
} from '@/shared/lib/qrButtonAnchor';

initLog('Module', '_layout loaded');

export const unstable_settings = {
  initialRouteName: '(drawer)',
};

// Prevent splash screen from auto-hiding until fonts are loaded
void SplashScreen.preventAutoHideAsync();

initLog('_layout', 'module loaded — SplashScreen.preventAutoHideAsync called');

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
      </OfflineShell>
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
// Reanimated CSS transitions on Android only accept predefined timing names.
// `ease-out` keeps the splash → QR-button morph soft without tripping runtime validation.
const MORPH_TIMING = 'ease-out';
// Generous wait for the QR anchor to publish. The morph overlay covers the
// screen for the entire window, so the user sees a continuous splash — this
// budget just bounds how long we hold before falling back to a plain fade
// when the user lands on a non-wallet screen (e.g. onboarding) where no QR
// button will ever publish. Sized to comfortably cover cold-start init on a
// first launch (legacy migration + global migration + nostr + coco) plus
// WalletScreen mount.
const MORPH_FALLBACK_TIMEOUT = 8000;
// Stability window for the QR-button anchor before kicking off the morph.
// The morph effect re-arms this timer every time the anchor changes, so
// the morph only fires once the position has been STABLE for this long.
// Combined with the polling interval below, the morph will track late
// layout shifts (iOS `contentInsetAdjustmentBehavior`, safe-area updates,
// wallpaper image load) instead of locking to an early/wrong position.
const LAYOUT_SETTLE_DELAY = 500;
// Hard wall-clock cap on the overlay's life, measured from `await_anchor`
// entry (native splash hidden). Anchor republishes restart the morph
// tween/timer by design; the cap guarantees restarts can only ever SHORTEN
// the remaining overlay life, never extend it indefinitely.
const OVERLAY_LIFETIME_CAP_MS = 10_000;
// Poll cadence for `measureInWindow` during the settle window. Cheap call —
// the store dedupes redundant anchor publishes via field-level equality.
const LAYOUT_POLL_INTERVAL = 100;
// UI-thread self-fade of the overlay's content after the tween docks. The JS
// completion timer that unmounts the overlay routinely fires 0.3–1.3s late on
// a congested boot thread, so the overlay must make itself invisible on the
// UI thread (transitionDelay = MORPH_DURATION_MS + DOCK_FADE_DELAY_MS) — the
// late timer then only performs the invisible unmount. The real QR button is
// already opaque underneath (it reveals at handoff, covered by the overlay
// for the whole tween), so the fade crosses identical pixels.
const DOCK_FADE_DELAY_MS = 100;
const DOCK_FADE_MS = 150;

// Linear phase machine for the boot splash → QR-button handoff.
//   await_init    — splash visible; waiting for our root view to lay out
//   await_anchor  — native splash hidden; waiting for the QR-button anchor
//                   (or MORPH_FALLBACK_TIMEOUT, whichever comes first)
//   morphing      — animating the overlay to the QR-button position
//   fading        — animating the overlay to opacity 0 (no anchor available)
//   unmounted     — overlay fully gone; real QR button takes over
//
// Each phase owns exactly one effect that drives its own forward transition,
// so there is no way to wedge: every phase either advances on a condition or
// on a fixed timer.
//
// IMPORTANT: we do NOT gate `await_init` on `useInitializationState`'s
// `isInitializing`. The InitializationGate chain registers stages one-at-a-
// time as each prior gate completes, so `isInitializing` flickers true→false
// between every gate handoff. Watching for the first false would have us
// hide the native splash before WalletScreen has even mounted, leaving the
// morph overlay to fade out over a black screen while the rest of the gate
// chain unrolls. The overlay covers the viewport for the whole `await_*`
// window, so it is always safe to hide the native splash once our own
// layout is ready — the QR anchor IS the "WalletScreen ready" signal we
// want to wait on.
type SplashPhase = 'await_init' | 'await_anchor' | 'morphing' | 'fading' | 'unmounted';

function NativeSplashLayoutGate({ children }: { children: React.ReactNode }) {
  useInitMount('NativeSplashLayoutGate');
  const { isInitializing } = useInitializationState();
  const [surfaceTertiary] = useThemeColor(['surface-tertiary'] as const);
  const rootViewRef = useRef<View>(null);
  const splashOverlayRef = useRef<View>(null);

  const [phase, setPhase] = useState<SplashPhase>('await_init');
  const [anchor, setAnchor] = useState<QRButtonAnchor | null>(getQRButtonAnchor());
  // Absolute deadline for the overlay's current cycle; armed on await_anchor
  // entry, consulted by the (restartable) morphing timer.
  const overlayDeadlineRef = useRef<number | null>(null);
  const [hasRootLaidOut, setHasRootLaidOut] = useState(false);
  // Window-relative offset of the splash overlay's parent View. The QRButton
  // publishes its anchor in window coords (pageX/pageY); to position the
  // overlay at that exact spot we need to subtract our own window offset
  // (a parent View further up may not start at window (0,0)).
  const [parentOffset, setParentOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const unsub = subscribeQRButtonAnchor((next) => {
      initLog('SplashMorph', `anchor published — ${next ? JSON.stringify(next) : 'null'}`);
      setAnchor(next);
    });
    return unsub;
  }, []);

  const onLayoutRootView = useCallback(() => {
    setHasRootLaidOut(true);
    rootViewRef.current?.measureInWindow((x, y) => {
      setParentOffset((prev) => (prev.x === x && prev.y === y ? prev : { x, y }));
      initLog('SplashMorph', `parent offset measured — x=${x} y=${y}`);
    });
  }, []);

  // Reset the machine on a profile switch. Only honored AFTER we've unmounted
  // from a prior cycle — during boot the same `isInitializing=true` signal
  // fires (gates registering) and we don't want it to bounce us back to
  // await_init from a later phase. Profile switches go through resetStages()
  // which sets forceReinitialize=true, so the unmount→isInitializing=true
  // transition is the unambiguous "switch happened" signal.
  useEffect(() => {
    if (!isInitializing) return;
    if (phase !== 'unmounted') return;
    setBootMorphCompleted(false);
    setBootSplashHandoff(false);
    setPhase('await_init');
  }, [isInitializing, phase]);

  // Phase 1 — await_init: hide the native splash as soon as our root view
  // has laid out. The morph overlay is rendered the same frame, covering the
  // viewport, so the visual transition from native splash → overlay is
  // seamless. Do NOT gate on `isInitializing` here — see the SplashPhase
  // type comment for why; the QR anchor in await_anchor is the real
  // "WalletScreen ready" signal.
  useEffect(() => {
    if (phase !== 'await_init') return;
    if (!hasRootLaidOut) return;
    initLog('SplashMorph', 'root laid out — hiding native splash');
    void SplashScreen.hideAsync();
    overlayDeadlineRef.current = Date.now() + OVERLAY_LIFETIME_CAP_MS;
    setPhase('await_anchor');
  }, [phase, hasRootLaidOut]);

  // Phase 2 — await_anchor: wait for the QR button to publish a stable
  // anchor. We poll `measureInWindow` for `LAYOUT_SETTLE_DELAY` ms because
  // ancestor layout (safe-area, wallpaper image load) can shift the button's
  // window position without firing a fresh `onLayout` on the button itself.
  // If we still have no anchor after `MORPH_FALLBACK_TIMEOUT`, fall back to
  // a plain fade so we never strand the user on the splash.
  useEffect(() => {
    if (phase !== 'await_anchor') return;

    let cancelled = false;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const clearSettleTimer = () => {
      if (!settleTimer) return;
      clearTimeout(settleTimer);
      settleTimer = null;
    };

    const startAnchorSettle = (reason: 'initial' | 'polled') => {
      if (cancelled || settleTimer) return;
      requestQRButtonRemeasure();
      initLog('SplashMorph', `anchor ${reason} — settling ${LAYOUT_SETTLE_DELAY}ms before morph`);

      settleTimer = setTimeout(() => {
        if (cancelled) return;
        const latest = getQRButtonAnchor();
        if (latest) {
          initLog(
            'SplashMorph',
            `morph start — target=${JSON.stringify(latest)} screen=${SCREEN.width}x${SCREEN.height}`
          );
          setAnchor(latest);
          setPhase('morphing');
          return;
        }
        initLog('SplashMorph', 'anchor disappeared during settle — fading out');
        setPhase('fading');
      }, LAYOUT_SETTLE_DELAY);
    };

    const initialAnchor = getQRButtonAnchor();
    if (initialAnchor) {
      setAnchor(initialAnchor);
      startAnchorSettle('initial');
    } else {
      initLog(
        'SplashMorph',
        `init done but no anchor yet — waiting up to ${MORPH_FALLBACK_TIMEOUT}ms`
      );
    }

    const poll = setInterval(() => {
      requestQRButtonRemeasure();
      if (getQRButtonAnchor()) startAnchorSettle('polled');
    }, LAYOUT_POLL_INTERVAL);

    const fallback = setTimeout(() => {
      if (cancelled || settleTimer) return;
      const latest = getQRButtonAnchor();
      if (latest) {
        initLog('SplashMorph', `late anchor — morphing to ${JSON.stringify(latest)}`);
        clearInterval(poll);
        requestQRButtonRemeasure();
        setAnchor(latest);
        setPhase('morphing');
      } else {
        initLog('SplashMorph', 'no anchor — fading out');
        clearInterval(poll);
        setPhase('fading');
      }
    }, MORPH_FALLBACK_TIMEOUT);

    return () => {
      cancelled = true;
      clearInterval(poll);
      clearTimeout(fallback);
      clearSettleTimer();
    };
  }, [phase]);

  // Phase 3 — morphing: signal the handoff (so destination screens can start
  // their own entrance animation), then advance to `done` after the CSS
  // transition's own duration. Reanimated 4 CSS Transitions don't fire a
  // completion callback, so we mirror the duration with a setTimeout.
  //
  // Deps include `anchor`/`parentOffset` ON PURPOSE: `overlayStyle` depends on
  // them, so a mid-morph anchor republish (wallpaper decode or safe-area
  // settle shifting the QR button) RESTARTS the CSS tween from scratch — the
  // completion timer must restart with it. With phase-only deps the original
  // timer yanked the overlay to done/unmounted while the restarted tween was
  // mid-flight, which is why the splash sometimes just vanished instead of
  // docking into the button.
  useEffect(() => {
    if (phase !== 'morphing') return;
    setBootSplashHandoff(true);
    // Clamp the (restartable) completion timer to the overlay's absolute
    // deadline so anchor-republish restarts can't extend its life forever.
    const remaining = overlayDeadlineRef.current
      ? Math.max(0, overlayDeadlineRef.current - Date.now())
      : MORPH_DURATION_MS + 30;
    const holdMs = Math.min(MORPH_DURATION_MS + 30, remaining);
    if (holdMs < MORPH_DURATION_MS + 30) {
      initLog('SplashMorph', `lifetime cap — clamping morph hold to ${holdMs}ms`);
    }
    initLog(
      'SplashMorph',
      `morph timer armed — ${holdMs}ms (restarts with the tween on anchor change)`
    );
    const id = setTimeout(() => {
      const node = splashOverlayRef.current as unknown as {
        measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void;
      } | null;
      node?.measureInWindow?.((x, y, w, h) => {
        initLog(
          'SplashMorph',
          `final overlay rect (window) — x=${x} y=${y} width=${w} height=${h}`
        );
      });
      // Unmount directly — no hold. The real QR button revealed at handoff
      // (underneath the opaque overlay), so it is already fully opaque by the
      // time the tween docks; and if this timer fired late (congested JS
      // thread), the overlay's dock fade has already made it invisible on the
      // UI thread. Either way there is nothing left to show.
      setBootMorphCompleted(true);
      setPhase('unmounted');
    }, holdMs);
    return () => clearTimeout(id);
  }, [phase, anchor, parentOffset]);

  // Fast-forward: the overlay is anchored to the WALLET tab's QR button and
  // renders above the whole navigator; the moment the wallet tab stops being
  // what the user looks at, finish the handoff invisibly instead of ghosting
  // the QR look-alike over feed/notifications. The policy fn's anchor guard
  // keeps profile-switch remounts (blur echo with a nulled anchor) from
  // cutting the replayed morph.
  useEffect(() => {
    // Only these two phases can meaningfully fast-forward: await_init must
    // still run its hideAsync handoff, and fading/done are already exiting.
    if (phase !== 'await_anchor' && phase !== 'morphing') return;
    const check = () => {
      if (!shouldFastForwardBootOverlay(getWalletTabFocused(), getQRButtonAnchor())) return;
      initLog('SplashMorph', `wallet tab not focused (phase=${phase}) — fast-forwarding overlay`);
      if (phase === 'morphing') {
        // Mid-morph ghost on the wrong tab: cut immediately.
        setBootSplashHandoff(true);
        setBootMorphCompleted(true);
        setPhase('unmounted');
      } else {
        // Full-screen splash (await_anchor): reuse the fading path — it sets
        // handoff + morphCompleted on its own timer.
        setPhase('fading');
      }
    };
    check();
    return subscribeWalletTabFocused(check);
  }, [phase, anchor]);

  // Phase 3b — fading: same duration mirror, but the fade's target values
  // never depend on the anchor, so an anchor republish must NOT restart it.
  // The overlay is at opacity 0 when the timer fires, so unmount directly.
  useEffect(() => {
    if (phase !== 'fading') return;
    setBootSplashHandoff(true);
    const id = setTimeout(() => {
      setBootMorphCompleted(true);
      setPhase('unmounted');
    }, MORPH_DURATION_MS + 30);
    return () => clearTimeout(id);
  }, [phase]);

  const showSplash = phase !== 'unmounted';
  const isMorphing = phase === 'morphing';
  const isFading = phase === 'fading';

  // Build the splash container style. Reanimated 4 CSS Transitions tween the
  // listed properties on the UI thread whenever their values change.
  // The container itself is transparent — the opaque white fill lives on the
  // content layer below so it can self-fade after docking without dragging
  // the geometry transition's timing along.
  const overlayStyle = useMemo(() => {
    const base = {
      position: 'absolute' as const,
      // Match the QRButton's `borderCurve: 'continuous'` (squircle) so the
      // morphed corners line up pixel-for-pixel with the real button at
      // handoff. iOS-only — Android falls back to standard arc which the
      // Android QRButton also uses.
      borderCurve: 'continuous' as const,
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

  // Content layer: owns the opaque white fill, centering, and every visual
  // child. Once the morph starts, it schedules its own UI-thread fade-out
  // timed to land just after the geometry tween docks (delay = tween duration
  // + DOCK_FADE_DELAY_MS). This is the congestion insurance: the JS unmount
  // timer below can fire arbitrarily late, but the overlay stops being
  // visible on schedule regardless — and the real QR button underneath is
  // already opaque (revealed at handoff), so the fade is pixel-invisible.
  const contentFadeStyle = useMemo(
    () => ({
      ...StyleSheet.absoluteFill,
      backgroundColor: '#FFFFFF',
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      opacity: isMorphing ? 0 : 1,
      transitionProperty: ['opacity'],
      transitionDuration: `${DOCK_FADE_MS}ms`,
      transitionDelay: `${MORPH_DURATION_MS + DOCK_FADE_DELAY_MS}ms`,
      transitionTimingFunction: MORPH_TIMING,
    }),
    [isMorphing]
  );

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
      ...StyleSheet.absoluteFill,
      opacity: isMorphing ? 1 : 0,
      transitionProperty: ['opacity'],
      transitionDuration: `${MORPH_DURATION_MS * 0.85}ms`,
      transitionTimingFunction: MORPH_TIMING,
    }),
    [isMorphing]
  );

  const qrIconLayerStyle = useMemo(
    () => ({
      ...StyleSheet.absoluteFill,
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
          {/* Content layer — solid white fill + all visuals. Self-fades on the
              UI thread after the tween docks (see contentFadeStyle). */}
          <Animated.View pointerEvents="none" style={contentFadeStyle}>
            {/* QR-button look-alike layered background. Replicates the exact
              stack the real QRButton uses (dark base + white-overlay + white
              top-to-bottom gradient + faint white border) so when the splash
              docks at the QR position and unmounts, the pixel handoff to
              the real button is seamless.
              Boot state: opacity 0 (the container's solid white shows through);
              morph state: opacity 1 (matches the QR gradient). */}
            <Animated.View pointerEvents="none" style={gradientLayerStyle}>
              <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0f0f12' }]} />
              <View
                style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,255,255,0.35)' }]}
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
                style={StyleSheet.absoluteFill}
              />
              <View
                style={[
                  StyleSheet.absoluteFill,
                  { borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
                ]}
              />
            </Animated.View>
            {/* Splash logo. Fades + scales out during morph. */}
            <Animated.Image source={REINIT_SPLASH_IMAGE} resizeMode="contain" style={logoStyle} />
            {/* QR icon. Fades in (delayed) so it's visible by the time the
              swap happens to the real button. */}
            <Animated.View pointerEvents="none" style={qrIconLayerStyle}>
              <Icon name="stash:qr-code" size={38} color={surfaceTertiary} />
            </Animated.View>
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
