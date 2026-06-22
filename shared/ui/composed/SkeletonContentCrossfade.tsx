/**
 * @fileoverview `SkeletonContentCrossfade` — the canonical skeleton → content
 * transition for the app.
 *
 * While `loading`, it renders the skeleton tree and (for sizeable regions) a
 * single `SkeletonLoadingShimmer` "wave" sweep over it. When data arrives the
 * skeleton **fades out** to reveal the real content sitting underneath it at
 * full opacity — so the content never fades from empty space, and any images
 * inside it fade in **independently** on their own `expo-image` transition
 * rather than blocking (or double-fading with) the swap.
 *
 * Why a region helper and not per-leaf animation: the loading primitives
 * (`Text loading`, `Skeleton`, `Avatar state="loading"`, `MintIcon isLoading`)
 * stay dumb geometry-preserving placeholders. Putting the fade here, at the
 * region seam, keeps those primitives cheap, avoids replaying opacity tweens on
 * FlashList row recycling, and preserves the "share the chrome" convention:
 * pass the SAME component in both branches —
 * `renderSkeleton={() => <Row loading />}` / `renderContent={() => <Row />}` —
 * and the skeleton overlay lines up pixel-for-pixel with the content, so the
 * swap shifts nothing.
 *
 * `exit="none"` skips the skeleton fade-out entirely (skeleton unmounts, content
 * appears) for FlashList-recycled lists where an exiting overlay would render in
 * a recycled cell's slot — there the real content owns its own entrance fade.
 *
 * Reduced-motion (system setting) drops both the wave and the fade for an
 * instant swap.
 */

import React, { useCallback, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { SkeletonLoadingShimmer } from '@/shared/ui/composed/SkeletonExitShimmer';

/** Canonical skeleton→content fade duration. Matches the thread reply reveal so
 *  the whole app crossfades at one cadence. */
const SKELETON_CONTENT_FADE_MS = 220;

type WaveMode = 'region' | 'none';
type ExitMode = 'fade' | 'none';
type Phase = 'loading' | 'exiting' | 'content';

interface SkeletonContentCrossfadeProps {
  /** True while the real data is loading. The skeleton shows; on the
   *  true→false edge the crossfade runs. */
  loading: boolean;
  /** The loading placeholder tree. Lazy so it isn't built once content shows. */
  renderSkeleton: () => ReactNode;
  /** The real content tree. Lazy so it isn't built while still loading. */
  renderContent: () => ReactNode;
  /** Fade duration in ms. Defaults to {@link SKELETON_CONTENT_FADE_MS}. */
  durationMs?: number;
  /** `'region'` (default) sweeps one shimmer wave over the skeleton; `'none'`
   *  keeps the cheaper static pulse for compact/inline placeholders. */
  wave?: WaveMode;
  /** `'fade'` (default) fades the skeleton out over the content; `'none'`
   *  unmounts the skeleton with no exit animation — use inside
   *  FlashList-recycled cells, where the content owns its own entrance. */
  exit?: ExitMode;
  /** Overrides the shimmer highlight tint. */
  highlightColor?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** Telemetry passthrough for the region shimmer (see `contentShiftLog`). */
  visualKey?: string;
  visualSurface?: string;
  visualComponent?: string;
  visualDisabled?: boolean;
}

export function SkeletonContentCrossfade({
  loading,
  renderSkeleton,
  renderContent,
  durationMs = SKELETON_CONTENT_FADE_MS,
  wave = 'region',
  exit = 'fade',
  highlightColor,
  style,
  testID,
  visualKey,
  visualSurface,
  visualComponent = 'SkeletonContentCrossfade',
  visualDisabled,
}: SkeletonContentCrossfadeProps) {
  const reducedMotion = useReducedMotion();
  const animatedExit = exit === 'fade' && !reducedMotion;
  const showWave = wave === 'region' && !reducedMotion;

  // Phase is seeded from `loading`, so a row that mounts already-loaded (e.g. a
  // recycled FlashList cell rebinding to loaded data) starts in 'content' and
  // never plays a spurious fade.
  const [phase, setPhase] = useState<Phase>(loading ? 'loading' : 'content');
  const skeletonOpacity = useSharedValue(1);

  const finishExit = useCallback(() => setPhase('content'), []);

  // React to the loading edge. Entering loading always wins and cancels an
  // in-flight exit fade (so rapid true→false→true never stacks overlays).
  useEffect(() => {
    if (loading) {
      cancelAnimation(skeletonOpacity);
      skeletonOpacity.set(1);
      setPhase('loading');
      return;
    }
    setPhase((prev) => {
      if (prev !== 'loading') return prev;
      return animatedExit ? 'exiting' : 'content';
    });
  }, [loading, animatedExit, skeletonOpacity]);

  // Drive the one-shot skeleton fade-out while exiting.
  useEffect(() => {
    if (phase !== 'exiting') return;
    skeletonOpacity.set(1);
    skeletonOpacity.set(
      withTiming(
        0,
        {
          duration: durationMs,
          easing: Easing.out(Easing.cubic),
          reduceMotion: ReduceMotion.System,
        },
        (finished) => {
          if (finished) runOnJS(finishExit)();
        }
      )
    );
    return () => cancelAnimation(skeletonOpacity);
  }, [phase, durationMs, skeletonOpacity, finishExit]);

  const exitStyle = useAnimatedStyle(() => ({ opacity: skeletonOpacity.get() }));

  if (phase === 'content') {
    return (
      <View style={style} testID={testID}>
        {renderContent()}
      </View>
    );
  }

  if (phase === 'loading') {
    return (
      <View style={style} testID={testID}>
        {renderSkeleton()}
        {showWave ? (
          <SkeletonLoadingShimmer
            active
            highlightColor={highlightColor}
            visualKey={visualKey}
            visualSurface={visualSurface}
            visualComponent={visualComponent}
            visualDisabled={visualDisabled}
          />
        ) : null}
      </View>
    );
  }

  // 'exiting' — real content sits at full opacity in normal flow; the skeleton
  // fades out on top of it (so images underneath fade in on their own).
  return (
    <View style={style} testID={testID}>
      {renderContent()}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, exitStyle]}>
        {renderSkeleton()}
      </Animated.View>
    </View>
  );
}
