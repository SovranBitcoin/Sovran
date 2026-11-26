/**
 * The wallpaper's blur and opacity behind the tab screens: one set of
 * animated values for the app, which each tab screen sets when it gains
 * focus and `BackgroundView` reads.
 */
import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { Easing, makeMutable, withTiming, type SharedValue } from 'react-native-reanimated';
import { log } from '@/shared/lib/logger';

/**
 * Blur mode options for background configuration
 */
type BlurMode = 'none' | 'partial' | 'full' | 'gradient';

/**
 * Configuration for background blur effects
 */
interface BackgroundConfig {
  blurMode: BlurMode;
  blurIntensity?: number;
  blurGradientStart?: number;
  blurGradientEnd?: number;
  /** Opacity of the background image (0-1). Default is 1 (fully opaque) */
  backgroundOpacity?: number;
  /** Background color shown behind the background image. Default is theme primary-900 */
  backgroundColor?: string;
}

/**
 * Animation configuration
 */
const ANIMATION_CONFIG = {
  duration: 300,
  easing: Easing.bezier(0.25, 0.1, 0.25, 1),
};

/**
 * Default configurations for each blur mode
 */
const DEFAULT_CONFIGS: Record<BlurMode, Required<Omit<BackgroundConfig, 'blurMode'>>> = {
  none: {
    blurIntensity: 0,
    blurGradientStart: 0.3,
    blurGradientEnd: 0.6,
    backgroundOpacity: 1,
    backgroundColor: '', // Empty string = use theme default (primary-900)
  },
  partial: {
    blurIntensity: 200,
    blurGradientStart: 0.3,
    blurGradientEnd: 0.6,
    backgroundOpacity: 1,
    backgroundColor: '',
  },
  full: {
    blurIntensity: 200,
    blurGradientStart: 0,
    blurGradientEnd: 0.1,
    backgroundOpacity: 1,
    backgroundColor: '',
  },
  gradient: {
    blurIntensity: 200,
    blurGradientStart: 0.3,
    blurGradientEnd: 0.6,
    backgroundOpacity: 1,
    backgroundColor: '',
  },
};

interface BackgroundValues {
  /** Current blur mode: 0=none, 1=partial, 2=full, 3=gradient. */
  blurMode: SharedValue<number>;
  blurIntensity: SharedValue<number>;
  blurGradientStart: SharedValue<number>;
  blurGradientEnd: SharedValue<number>;
  /** Partial mode: opacity of the fixed bottom blur. */
  partialBlurOpacity: SharedValue<number>;
  /** Full mode: opacity of the full blur. */
  fullBlurOpacity: SharedValue<number>;
  /** Background image opacity (0-1). */
  backgroundOpacity: SharedValue<number>;
  /** Color behind the image; empty means the theme default (primary-900). */
  backgroundColor: SharedValue<string>;
}

let values: BackgroundValues | null = null;

/** The shared background values, created on first use (partial blur). */
export function getBackgroundValues(): BackgroundValues {
  values ??= {
    blurMode: makeMutable(1),
    blurIntensity: makeMutable(200),
    blurGradientStart: makeMutable(0.3),
    blurGradientEnd: makeMutable(0.6),
    partialBlurOpacity: makeMutable(1),
    fullBlurOpacity: makeMutable(0),
    backgroundOpacity: makeMutable(1),
    backgroundColor: makeMutable(''),
  };
  return values;
}

function setBackgroundConfig(config: BackgroundConfig): void {
  const {
    blurMode,
    blurIntensity,
    blurGradientStart,
    blurGradientEnd,
    partialBlurOpacity,
    fullBlurOpacity,
    backgroundOpacity,
    backgroundColor,
  } = getBackgroundValues();
  // Map blur mode to number
  const modeMap: Record<BlurMode, number> = {
    none: 0,
    partial: 1,
    full: 2,
    gradient: 3,
  };
  const targetMode = modeMap[config.blurMode];
  const bgOpacity = config.backgroundOpacity ?? 1;

  // Skip if mode and opacity haven't changed — avoids redundant animations on tab refocus
  if (blurMode.get() === targetMode && backgroundOpacity.get() === bgOpacity) {
    return;
  }

  log.info('bg.blur.transition', {
    blurMode: config.blurMode,
    backgroundOpacity: bgOpacity,
    animationMs: ANIMATION_CONFIG.duration,
  });
  const defaults = DEFAULT_CONFIGS[config.blurMode];
  const intensity = config.blurIntensity ?? defaults.blurIntensity;
  const gradientStart = config.blurGradientStart ?? defaults.blurGradientStart;
  const gradientEnd = config.blurGradientEnd ?? defaults.blurGradientEnd;
  const bgColor = config.backgroundColor ?? ''; // Empty string = use theme default

  // Animate to new values
  blurMode.set(targetMode);
  blurIntensity.set(withTiming(intensity, ANIMATION_CONFIG));
  blurGradientStart.set(withTiming(gradientStart, ANIMATION_CONFIG));
  blurGradientEnd.set(withTiming(gradientEnd, ANIMATION_CONFIG));
  backgroundOpacity.set(withTiming(bgOpacity, ANIMATION_CONFIG));
  backgroundColor.set(bgColor); // Color changes instantly (no animation)

  // Animate opacity based on mode
  switch (config.blurMode) {
    case 'none':
      partialBlurOpacity.set(withTiming(0, ANIMATION_CONFIG));
      fullBlurOpacity.set(withTiming(0, ANIMATION_CONFIG));
      break;
    case 'partial':
      partialBlurOpacity.set(withTiming(1, ANIMATION_CONFIG));
      fullBlurOpacity.set(withTiming(0, ANIMATION_CONFIG));
      break;
    case 'full':
      partialBlurOpacity.set(withTiming(0, ANIMATION_CONFIG));
      fullBlurOpacity.set(withTiming(1, ANIMATION_CONFIG));
      break;
    case 'gradient':
      partialBlurOpacity.set(withTiming(0, ANIMATION_CONFIG));
      fullBlurOpacity.set(withTiming(0, ANIMATION_CONFIG));
      break;
  }
}

/**
 * Hook for tab screens to register their blur configuration
 * Automatically updates when the screen gains focus
 */
export function useBackgroundConfig(config: BackgroundConfig) {
  // Destructured so the dependencies are plain identifiers rather than member
  // expressions off an object callers rebuild on every render. Keep this list
  // exhaustive over `BackgroundConfig`: a field added there but not destructured
  // here would stop propagating on change, silently.
  const {
    blurMode,
    blurIntensity,
    blurGradientStart,
    blurGradientEnd,
    backgroundOpacity,
    backgroundColor,
  } = config;

  useFocusEffect(
    useCallback(() => {
      setBackgroundConfig({
        blurMode,
        blurIntensity,
        blurGradientStart,
        blurGradientEnd,
        backgroundOpacity,
        backgroundColor,
      });
    }, [
      blurMode,
      blurIntensity,
      blurGradientStart,
      blurGradientEnd,
      backgroundOpacity,
      backgroundColor,
    ])
  );
}
