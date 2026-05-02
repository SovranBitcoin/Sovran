import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import opacity from 'hex-color-opacity';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { router } from 'expo-router';
import { WalletHealthCardFrame } from '@/features/health/components/WalletHealthCardFrame';
import { ClaimUsernameCardFrame } from '@/shared/blocks/claim/ClaimUsernameCardFrame';
import { measureInWindowAsync, rafAsync } from './measure';
import type { HeroId, Rect, HeroRole } from './types';

type HeroTransitionPhase =
  | { state: 'idle' }
  | { state: 'forward_navigating'; id: HeroId; params?: Record<string, string> }
  | { state: 'forward_animating'; id: HeroId; params?: Record<string, string> }
  | { state: 'back_navigating'; id: HeroId; params?: Record<string, string> }
  | { state: 'back_animating'; id: HeroId; params?: Record<string, string> };

type Ctx = {
  registerRef: (id: HeroId, role: HeroRole, ref: any) => void;
  startWalletHealth: (unit: string) => void;
  closeWalletHealth: (unit: string) => void;
  startClaimUsername: () => void;
  closeClaimUsername: () => void;
  isHidden: (id: HeroId, role: HeroRole) => boolean;
  isAnimating: (id: HeroId) => boolean;
  isTransitioning: (id: HeroId) => boolean;
};

const HeroTransitionContext = createContext<Ctx | null>(null);

const DURATION_MS = 520;

export function HeroTransitionProvider({ children }: { children: React.ReactNode }) {
  const [background, surfaceForeground, red] = useThemeColor([
    'background',
    'surface-foreground',
    'danger',
  ] as const);
  const primary950 = background;
  const primary50 = surfaceForeground;
  const gold = '#f59e0b';

  const refs = useRef<Record<HeroId, Partial<Record<HeroRole, any>>>>({
    walletHealth: {},
    claimUsername: {},
  });

  const [phase, setPhase] = useState<HeroTransitionPhase>({ state: 'idle' });
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [overlayBorderColor, setOverlayBorderColor] = useState<string>(opacity(red, 0.25));

  const progress = useSharedValue(0);
  const fromX = useSharedValue(0);
  const fromY = useSharedValue(0);
  const fromW = useSharedValue(0);
  const fromH = useSharedValue(0);
  const toX = useSharedValue(0);
  const toY = useSharedValue(0);
  const toW = useSharedValue(0);
  const toH = useSharedValue(0);

  const registerRef = useCallback((id: HeroId, role: HeroRole, ref: any) => {
    refs.current[id] = refs.current[id] || {};
    refs.current[id][role] = ref;
  }, []);

  const animateOverlay = useCallback(
    (fromRect: Rect, toRect: Rect, onDone: () => void) => {
      // Set geometry synchronously so the overlay never mounts "empty/invisible".
      fromX.set(fromRect.x);
      fromY.set(fromRect.y);
      fromW.set(fromRect.width);
      fromH.set(fromRect.height);
      toX.set(toRect.x);
      toY.set(toRect.y);
      toW.set(toRect.width);
      toH.set(toRect.height);

      // Drive animation directly from JS thread — reanimated handles the UI-thread
      // transition internally. On completion, bounce back to JS via runOnJS.
      // (Previously used scheduleOnUI/scheduleOnRN from react-native-worklets which
      // caused SIGABRT crashes when combined with navigation transitions.)
      cancelAnimation(progress);
      progress.set(0);
      progress.set(
        withTiming(1, { duration: DURATION_MS, easing: Easing.out(Easing.cubic) }, (finished) => {
          'worklet';
          if (finished) {
            runOnJS(onDone)();
          }
        })
      );
    },
    [fromH, fromW, fromX, fromY, progress, toH, toW, toX, toY]
  );

  const overlayStyle = useAnimatedStyle(() => {
    const p = progress.get();

    const fx = fromX.get();
    const fy = fromY.get();
    const fw = fromW.get();
    const fh = fromH.get();

    if (fw <= 0 || fh <= 0) return { opacity: 0 };

    const hasTo = toW.get() > 0 && toH.get() > 0;

    const tx = toX.get();
    const ty = toY.get();
    const tw = toW.get();
    const th = toH.get();

    // Avoid non-uniform scaling (scaleX/scaleY) which stretches inner visuals (e.g. hearts).
    // Instead, animate size (width/height) and move via transform translate.
    const width = hasTo ? fw + (tw - fw) * p : fw;
    const height = hasTo ? fh + (th - fh) * p : fh;

    const translateX = hasTo ? (tx - fx) * p : 0;
    const translateY = hasTo ? (ty - fy) * p : 0;

    return {
      position: 'absolute',
      left: fx,
      top: fy,
      width,
      height,
      borderRadius: 20,
      borderCurve: 'continuous' as const,
      overflow: 'hidden' as const,
      opacity: 1,
      transform: [{ translateX }, { translateY }],
    };
  });

  const isAnimating = useCallback(
    (id: HeroId) =>
      (phase.state === 'forward_animating' || phase.state === 'back_animating') && phase.id === id,
    [phase]
  );

  const isTransitioning = useCallback(
    (id: HeroId) => overlayVisible && phase.state !== 'idle' && 'id' in phase && phase.id === id,
    [overlayVisible, phase]
  );

  const isHidden = useCallback(
    (id: HeroId, role: HeroRole) => {
      // While overlay is visible, hide both source and destination nodes to avoid double-render flicker.
      // (The overlay is the "one true" element during the morph.)
      if (!overlayVisible) return false;
      if (phase.state === 'idle') return false;
      if (!('id' in phase)) return false;
      if (phase.id !== id) return false;
      return role === 'source' || role === 'destination';
    },
    [overlayVisible, phase]
  );

  const startWalletHealth = useCallback(
    async (unit: string) => {
      if (phase.state !== 'idle') return;

      const sourceRef = refs.current.walletHealth?.source;
      const fromRect = await measureInWindowAsync(sourceRef);
      if (!fromRect) {
        router.navigate({ pathname: '/healthModal', params: { unit } });
        return;
      }

      setOverlayBorderColor(opacity(red, 0.25));
      setPhase({ state: 'forward_navigating', id: 'walletHealth', params: { unit } });
      setOverlayVisible(true);
      // Prime overlay geometry immediately (pins overlay to source until destination is known).
      cancelAnimation(progress);
      fromX.set(fromRect.x);
      fromY.set(fromRect.y);
      fromW.set(fromRect.width);
      fromH.set(fromRect.height);
      toX.set(0);
      toY.set(0);
      toW.set(0);
      toH.set(0);
      progress.set(0);

      router.navigate({ pathname: '/healthModal', params: { unit } });

      // Wait until destination registers and layout stabilizes.
      // (This can take a bit on slower devices and with transparent headers.)
      for (let i = 0; i < 30; i++) {
        await rafAsync();
        const destRef = refs.current.walletHealth?.destination;
        const toRect = await measureInWindowAsync(destRef);
        if (toRect) {
          // One extra settle frame to reduce layout jitter (header/safe-area settling).
          await rafAsync();
          const toRectSettled = (await measureInWindowAsync(destRef)) ?? toRect;
          setPhase({ state: 'forward_animating', id: 'walletHealth', params: { unit } });
          animateOverlay(fromRect, toRectSettled, () => {
            setOverlayVisible(false);
            setPhase({ state: 'idle' });
          });
          return;
        }
      }

      // Fallback: if we can't measure destination, just drop the overlay.
      setOverlayVisible(false);
      setPhase({ state: 'idle' });
    },
    [animateOverlay, fromH, fromW, fromX, fromY, phase.state, progress, red, toH, toW, toX, toY]
  );

  const closeWalletHealth = useCallback(
    async (unit: string) => {
      if (phase.state !== 'idle') return;

      const destRef = refs.current.walletHealth?.destination;
      const fromRect = await measureInWindowAsync(destRef);
      if (!fromRect) {
        router.back();
        return;
      }

      setOverlayBorderColor(opacity(red, 0.25));
      setPhase({ state: 'back_navigating', id: 'walletHealth', params: { unit } });
      setOverlayVisible(true);

      // Prime overlay at the destination rect so it's visible immediately.
      cancelAnimation(progress);
      fromX.set(fromRect.x);
      fromY.set(fromRect.y);
      fromW.set(fromRect.width);
      fromH.set(fromRect.height);
      toX.set(0);
      toY.set(0);
      toW.set(0);
      toH.set(0);
      progress.set(0);

      // IMPORTANT: pop immediately so the Explore screen is visible right away.
      router.back();

      // Now wait for the source card to be laid out on Explore, then animate overlay to it.
      for (let i = 0; i < 30; i++) {
        await rafAsync();
        const sourceRef = refs.current.walletHealth?.source;
        const toRect = await measureInWindowAsync(sourceRef);
        if (!toRect) continue;

        setPhase({ state: 'back_animating', id: 'walletHealth', params: { unit } });
        animateOverlay(fromRect, toRect, () => {
          setOverlayVisible(false);
          setPhase({ state: 'idle' });
        });
        return;
      }

      // Fallback: if we can't measure the source, drop overlay.
      setOverlayVisible(false);
      setPhase({ state: 'idle' });
    },
    [animateOverlay, fromH, fromW, fromX, fromY, phase.state, progress, red, toH, toW, toX, toY]
  );

  const startClaimUsername = useCallback(async () => {
    if (phase.state !== 'idle') return;

    const sourceRef = refs.current.claimUsername?.source;
    const fromRect = await measureInWindowAsync(sourceRef);
    if (!fromRect) {
      router.navigate('/claimUsername');
      return;
    }

    setOverlayBorderColor(opacity(gold, 0.3));
    setPhase({ state: 'forward_navigating', id: 'claimUsername' });
    setOverlayVisible(true);

    cancelAnimation(progress);
    fromX.set(fromRect.x);
    fromY.set(fromRect.y);
    fromW.set(fromRect.width);
    fromH.set(fromRect.height);
    toX.set(0);
    toY.set(0);
    toW.set(0);
    toH.set(0);
    progress.set(0);

    router.navigate('/claimUsername');

    for (let i = 0; i < 30; i++) {
      await rafAsync();
      const destRef = refs.current.claimUsername?.destination;
      const toRect = await measureInWindowAsync(destRef);
      if (toRect) {
        await rafAsync();
        const toRectSettled = (await measureInWindowAsync(destRef)) ?? toRect;
        setPhase({ state: 'forward_animating', id: 'claimUsername' });
        animateOverlay(fromRect, toRectSettled, () => {
          setOverlayVisible(false);
          setPhase({ state: 'idle' });
        });
        return;
      }
    }

    setOverlayVisible(false);
    setPhase({ state: 'idle' });
  }, [animateOverlay, fromH, fromW, fromX, fromY, phase.state, progress, toH, toW, toX, toY]);

  const closeClaimUsername = useCallback(async () => {
    if (phase.state !== 'idle') return;

    const destRef = refs.current.claimUsername?.destination;
    const fromRect = await measureInWindowAsync(destRef);
    if (!fromRect) {
      router.back();
      return;
    }

    setOverlayBorderColor(opacity(gold, 0.3));
    setPhase({ state: 'back_navigating', id: 'claimUsername' });
    setOverlayVisible(true);

    cancelAnimation(progress);
    fromX.set(fromRect.x);
    fromY.set(fromRect.y);
    fromW.set(fromRect.width);
    fromH.set(fromRect.height);
    toX.set(0);
    toY.set(0);
    toW.set(0);
    toH.set(0);
    progress.set(0);

    router.back();

    for (let i = 0; i < 30; i++) {
      await rafAsync();
      const sourceRef = refs.current.claimUsername?.source;
      const toRect = await measureInWindowAsync(sourceRef);
      if (!toRect) continue;

      setPhase({ state: 'back_animating', id: 'claimUsername' });
      animateOverlay(fromRect, toRect, () => {
        setOverlayVisible(false);
        setPhase({ state: 'idle' });
      });
      return;
    }

    setOverlayVisible(false);
    setPhase({ state: 'idle' });
  }, [animateOverlay, fromH, fromW, fromX, fromY, phase.state, progress, toH, toW, toX, toY]);

  const value = useMemo<Ctx>(
    () => ({
      registerRef,
      startWalletHealth,
      closeWalletHealth,
      startClaimUsername,
      closeClaimUsername,
      isHidden,
      isAnimating,
      isTransitioning,
    }),
    [
      registerRef,
      startWalletHealth,
      closeWalletHealth,
      startClaimUsername,
      closeClaimUsername,
      isHidden,
      isAnimating,
      isTransitioning,
    ]
  );

  return (
    <HeroTransitionContext.Provider value={value}>
      {children}
      {overlayVisible &&
        (Platform.OS === 'web' ? (
          <Animated.View
            pointerEvents="none"
            style={[
              overlayStyle,
              {
                zIndex: 9999,
                borderWidth: 1,
                borderColor: overlayBorderColor,
              },
            ]}>
            {'id' in phase && phase.id === 'claimUsername' ? (
              <ClaimUsernameCardFrame
                accentColor={gold}
                backgroundColor={primary950}
                highlightColor={primary50}
              />
            ) : (
              <WalletHealthCardFrame
                accentColor={red}
                backgroundColor={primary950}
                highlightColor={primary50}
              />
            )}
          </Animated.View>
        ) : (
          // Native-stack uses separate native views for screens; FullWindowOverlay ensures our hero overlay
          // renders above the navigation transition.
          <FullWindowOverlay>
            <Animated.View
              pointerEvents="none"
              // Keep complex gradients/icons GPU-composited during motion.
              shouldRasterizeIOS
              renderToHardwareTextureAndroid
              style={[
                overlayStyle,
                {
                  zIndex: 9999,
                  borderWidth: 1,
                  borderColor: overlayBorderColor,
                },
              ]}>
              {'id' in phase && phase.id === 'claimUsername' ? (
                <ClaimUsernameCardFrame
                  accentColor={gold}
                  backgroundColor={primary950}
                  highlightColor={primary50}
                />
              ) : (
                <WalletHealthCardFrame
                  accentColor={red}
                  backgroundColor={primary950}
                  highlightColor={primary50}
                />
              )}
            </Animated.View>
          </FullWindowOverlay>
        ))}
    </HeroTransitionContext.Provider>
  );
}

export function useHeroTransition() {
  const ctx = useContext(HeroTransitionContext);
  if (!ctx) {
    throw new Error('useHeroTransition must be used within HeroTransitionProvider');
  }
  return ctx;
}
