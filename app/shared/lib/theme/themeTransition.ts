/**
 * Account-switch theme transition (module-level reanimated mutables so
 * ThemeProvider — which mounts ABOVE BackgroundProvider — can drive layers
 * that BackgroundView renders, without provider-order gymnastics).
 *
 * Wallpapers: fade the themed image/gradient layer out, swap the theme (CSS
 * vars + context, which re-points the sprite) at the dip, fade back in.
 * Colors: the base surface interpolates from the old theme's surface to the
 * new one over the whole transition, so color-only themes glide instead of
 * snapping.
 */

import { makeMutable, runOnJS, withTiming } from 'react-native-reanimated';

const FADE_OUT_MS = 160;
const FADE_IN_MS = 260;
const COLOR_MS = 420;

/** Multiplied into the themed background layer's opacity. */
export const themeLayerOpacity = makeMutable(1);
/** Surface color interpolation endpoints + progress (0→1). */
export const themeSurfaceFrom = makeMutable<string | null>(null);
export const themeSurfaceTo = makeMutable<string | null>(null);
export const themeSurfaceProgress = makeMutable(1);

/** First (boot) apply — set endpoints without animating. */
export function primeThemeSurface(surface: string | null): void {
  themeSurfaceFrom.value = surface;
  themeSurfaceTo.value = surface;
  themeSurfaceProgress.value = 1;
}

/**
 * Fade out → `swap()` (apply vars + advance the displayed theme) → fade in,
 * while the base surface color glides to `nextSurface`.
 */
export function runThemeTransition(nextSurface: string | null, swap: () => void): void {
  themeSurfaceFrom.value = themeSurfaceTo.value;
  if (nextSurface) themeSurfaceTo.value = nextSurface;
  themeSurfaceProgress.value = 0;
  themeSurfaceProgress.value = withTiming(1, { duration: COLOR_MS });

  themeLayerOpacity.value = withTiming(0, { duration: FADE_OUT_MS }, (finished) => {
    if (finished) runOnJS(swap)();
    themeLayerOpacity.value = withTiming(1, { duration: FADE_IN_MS });
  });
}
