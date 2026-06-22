/**
 * @fileoverview `SkeletonContentCrossfade` — the canonical skeleton → content
 * transition for the app.
 *
 * While `loading`, it renders the skeleton tree and (for sizeable regions) a
 * single `SkeletonLoadingShimmer` "wave" sweep over it. When data arrives it
 * runs ONE consistent transition everywhere: the skeleton **fades out**, then
 * the real content **fades in** — a clear two-step crossfade, fast enough not to
 * feel like waiting (`SKELETON_CONTENT_FADE_MS` total). Images inside the
 * content fade in **independently** on their own `expo-image` transition, so the
 * swap never blocks on a slow image load.
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
 * `exit="none"` skips the fade entirely (skeleton unmounts, content appears) for
 * FlashList-recycled lists where an exiting overlay would render in a recycled
 * cell's slot, and for footer-only skeletons that have no in-place content to
 * fade into.
 *
 * Reduced-motion (system setting) drops both the wave and the fade for an
 * instant swap.
 */

import React, { useCallback, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { SkeletonLoadingShimmer } from '@/shared/ui/composed/SkeletonExitShimmer';

/** Total skeleton→content transition: the skeleton fades out over the first
 *  half, the content fades in over the second. Kept short so the swap reads as a
 *  crisp crossfade, not a wait. */
const SKELETON_CONTENT_FADE_MS = 300;

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
  /** Total fade duration in ms. Defaults to {@link SKELETON_CONTENT_FADE_MS}. */
  durationMs?: number;
  /** `'region'` (default) sweeps one shimmer wave over the skeleton; `'none'`
   *  keeps the cheaper static pulse for compact/inline placeholders. */
  wave?: WaveMode;
  /** `'fade'` (default) runs the skeleton-out/content-in crossfade; `'none'`
   *  swaps instantly — use inside FlashList-recycled cells and for footer-only
   *  skeletons with no in-place content. */
  exit?: ExitMode;
  /** Overrides the shimmer highlight tint (defaults to the theme `surface`). */
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
  const surface = useThemeColor('surface');
  // Surface-tinted highlight (matching the thread shimmer) — the background-tint
  // fallback is nearly invisible, which reads as "no wave".
  const resolvedHighlight = highlightColor ?? surface;
  const animatedExit = exit === 'fade' && !reducedMotion;
  const showWave = wave === 'region' && !reducedMotion;

  // Phase is seeded from `loading`, so a row that mounts already-loaded (e.g. a
  // recycled FlashList cell rebinding to loaded data) starts in 'content' and
  // never plays a spurious fade.
  const [phase, setPhase] = useState<Phase>(loading ? 'loading' : 'content');
  // 0 → 1 across the whole transition: [0, 0.5] fades the skeleton out, then
  // [0.5, 1] fades the content in.
  const progress = useSharedValue(0);

  const finishExit = useCallback(() => setPhase('content'), []);

  // React to the loading edge. Entering loading always wins and cancels an
  // in-flight exit (so rapid true→false→true never stacks overlays).
  useEffect(() => {
    if (loading) {
      cancelAnimation(progress);
      progress.set(0);
      setPhase('loading');
      return;
    }
    setPhase((prev) => {
      if (prev !== 'loading') return prev;
      return animatedExit ? 'exiting' : 'content';
    });
  }, [loading, animatedExit, progress]);

  // Drive the one-shot crossfade while exiting.
  useEffect(() => {
    if (phase !== 'exiting') return;
    progress.set(0);
    progress.set(
      withTiming(
        1,
        {
          duration: durationMs,
          easing: Easing.inOut(Easing.quad),
          reduceMotion: ReduceMotion.System,
        },
        (finished) => {
          if (finished) runOnJS(finishExit)();
        }
      )
    );
    return () => cancelAnimation(progress);
  }, [phase, durationMs, progress, finishExit]);

  const skeletonExitStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.5], [1, 0], Extrapolation.CLAMP),
  }));
  const contentEnterStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0.5, 1], [0, 1], Extrapolation.CLAMP),
  }));

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
            highlightColor={resolvedHighlight}
            visualKey={visualKey}
            visualSurface={visualSurface}
            visualComponent={visualComponent}
            visualDisabled={visualDisabled}
          />
        ) : null}
      </View>
    );
  }

  // 'exiting' — content fades in (second half) in normal flow (it owns the
  // height, so no shift); the skeleton fades out (first half) on top of it.
  return (
    <View style={style} testID={testID}>
      <Animated.View style={contentEnterStyle}>{renderContent()}</Animated.View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, skeletonExitStyle]}>
        {renderSkeleton()}
      </Animated.View>
    </View>
  );
}
