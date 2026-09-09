/**
 * @fileoverview `SkeletonContentCrossfade` — the canonical skeleton → content
 * transition for the app.
 *
 * While `loading`, it renders the skeleton tree and (for sizeable regions) a
 * single `SkeletonLoadingShimmer` "wave" sweep over it. When data arrives it
 * mounts real content at full opacity and fades the skeleton out over it.
 * Keeping the content opaque avoids an empty midpoint. Images inside the
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

import { useCallback, useEffect, useState, type ReactNode } from 'react';
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

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useScreenBackground } from '@/shared/ui/composed/ScreenFooterContext';
import { useFadeRevealProbe } from '@/shared/lib/debug/fadeRevealProbe';
import { SkeletonLoadingShimmer } from '@/shared/ui/composed/SkeletonExitShimmer';

/** The skeleton fades away while loaded content is already visible below it. */
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
  /** Total fade duration in ms. Defaults to {@link SKELETON_CONTENT_FADE_MS}. */
  durationMs?: number;
  /** `'region'` (default) sweeps one shimmer wave over the skeleton; `'none'`
   *  keeps the cheaper static pulse for compact/inline placeholders. */
  wave?: WaveMode;
  /** `'fade'` (default) fades the skeleton out over loaded content; `'none'`
   *  swaps instantly — use inside FlashList-recycled cells and for footer-only
   *  skeletons with no in-place content. */
  exit?: ExitMode;
  /** The color of the surface the skeleton sits ON — the wave is painted in this
   *  color so it "erases" the skeleton as it sweeps (disappear/reappear), rather
   *  than reading as a stripe on top. Defaults to the resolved screen background; pass
   *  the container's color when the skeleton is on a card/surface (e.g. a
   *  `surface-secondary` Card). This is the only thing that should set the wave
   *  color — never a brand/accent tint. */
  surfaceColor?: string;
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
  surfaceColor,
  style,
  testID,
  visualKey,
  visualSurface,
  visualComponent = 'SkeletonContentCrossfade',
  visualDisabled,
}: SkeletonContentCrossfadeProps) {
  const reducedMotion = useReducedMotion();
  // The wave is painted in the color of the surface the skeleton sits on, so the
  // band "erases" the skeleton as it sweeps (disappear/reappear) rather than
  // reading as a brighter stripe on top. Defaults to the resolved screen background;
  // callers on a card/surface pass that surface's color.
  const screenBackground = useThemeColor('surface');
  const pageBackground = useScreenBackground();
  const waveColor = surfaceColor ?? pageBackground ?? screenBackground;
  const animatedExit = exit === 'fade' && !reducedMotion;
  const showWave = wave === 'region' && !reducedMotion;

  // Phase is seeded from `loading`, so a row that mounts already-loaded (e.g. a
  // recycled FlashList cell rebinding to loaded data) starts in 'content' and
  // never plays a spurious fade.
  const [phase, setPhase] = useState<Phase>(loading ? 'loading' : 'content');
  // 0 → 1 fades only the skeleton overlay; content remains fully opaque.
  const progress = useSharedValue(0);

  const finishExit = useCallback(() => setPhase('content'), []);

  // A stuck exit can leave a skeleton overlay covering loaded content.
  useFadeRevealProbe(`skeleton.crossfade:${visualKey ?? visualComponent}`, progress, {
    enabled: phase === 'exiting',
    deadlineMs: durationMs + 900,
  });

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
    opacity: 1 - progress.get(),
  }));

  if (loading || phase === 'loading') {
    return (
      <View style={style} testID={testID}>
        {renderSkeleton()}
        {showWave ? (
          <SkeletonLoadingShimmer
            active
            highlightColor={waveColor}
            visualKey={visualKey}
            visualSurface={visualSurface}
            visualComponent={visualComponent}
            visualDisabled={visualDisabled}
          />
        ) : null}
      </View>
    );
  }

  // Keep this host identical during and after the exit so finishing the fade
  // cannot remount content, restart its effects, or reset local state.
  return (
    <View style={style} testID={testID}>
      {renderContent()}
      {phase === 'exiting' ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, skeletonExitStyle]}>
          {renderSkeleton()}
        </Animated.View>
      ) : null}
    </View>
  );
}
