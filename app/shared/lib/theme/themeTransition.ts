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
import { themeVariables, getThemeVariables } from '@/shared/lib/themeEngine';

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

/** The theme's base surface hex — endpoints for color interpolation. */
export function surfaceOfTheme(theme: string): string | null {
  const vars = themeVariables[theme] ?? getThemeVariables(theme);
  return (vars?.['--surface'] as string | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Drag-driven crossfade (the account carousel): the adjacent account's
// wallpaper mounts the moment a drag starts and both layers' opacities (and
// the surface color) track the drag fraction directly — the release
// animation is just the pager settling.
// ---------------------------------------------------------------------------

/** 0..1 progress toward `themeDragTarget` (drag fraction). */
export const themeDragProgress = makeMutable(0);

let dragTargetTheme: string | null = null;
const dragListeners = new Set<() => void>();

function notifyDragListeners(): void {
  dragListeners.forEach((listener) => listener());
}

export function getThemeDragTarget(): string | null {
  return dragTargetTheme;
}

export function subscribeThemeDragTarget(listener: () => void): () => void {
  dragListeners.add(listener);
  return () => {
    dragListeners.delete(listener);
  };
}

/** Mount the target theme's wallpaper layer + set color endpoints. */
export function beginThemeDrag(targetTheme: string, fromSurface: string | null): void {
  if (dragTargetTheme !== targetTheme) {
    dragTargetTheme = targetTheme;
    if (fromSurface) themeSurfaceFrom.value = fromSurface;
    const toSurface = surfaceOfTheme(targetTheme);
    if (toSurface) themeSurfaceTo.value = toSurface;
    notifyDragListeners();
  }
}

/** Drag released without crossing — glide back to the current theme. */
export function cancelThemeDrag(): void {
  if (dragTargetTheme === null) {
    themeDragProgress.value = 0;
    return;
  }
  themeDragProgress.value = withTiming(0, { duration: 140 }, (finished) => {
    if (finished) runOnJS(releaseDragTarget)();
  });
}

function releaseDragTarget(): void {
  dragTargetTheme = null;
  notifyDragListeners();
}

/**
 * Settled on the target: the base theme now IS the target (vars applied by
 * ThemeProvider), so unmount the drag layer after the base has a frame to
 * paint the same wallpaper underneath.
 */
export function completeThemeDrag(): void {
  setTimeout(() => {
    dragTargetTheme = null;
    themeDragProgress.value = 0;
    notifyDragListeners();
  }, 250);
}
