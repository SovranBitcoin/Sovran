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
 *
 * This dip-through-surface is the right visual ONLY for color-only targets
 * (there is no image to crossfade to). Image-wallpaper targets go through
 * `startThemeCrossfade` instead — dipping a full-bleed photo to a solid color
 * and back reads as a flash.
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
/** Drag target as a SHARED VALUE too: pre-mounted layers compare against it
 *  in their opacity worklets, so starting a drag touches zero React state
 *  when the target's layer is already mounted. */
export const themeDragTargetSv = makeMutable<string | null>(null);

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

/** Mount the target theme's wallpaper layer + set color endpoints (used by releaseThemeDrag). */
function beginThemeDrag(targetTheme: string, fromSurface: string | null): void {
  if (dragTargetTheme !== targetTheme) {
    // Re-targeting mid-fade (rapid swipes): the new fade starts CLEAN —
    // progress back to 0 (the new layer must not pop in at the old fade's
    // value) and any pending after-fade callbacks belong to the abandoned
    // target, so they are dropped.
    dragTargetTheme = targetTheme;
    themeDragTargetSv.value = targetTheme;
    themeDragProgress.value = 0;
    afterFadeCallbacks = [];
    pendingReleaseTarget = null;
    if (releaseFallbackTimer) {
      clearTimeout(releaseFallbackTimer);
      releaseFallbackTimer = null;
    }
    if (fromSurface) themeSurfaceFrom.value = fromSurface;
    const toSurface = surfaceOfTheme(targetTheme);
    if (toSurface) themeSurfaceTo.value = toSurface;
    notifyDragListeners();
  }
}

const RELEASE_FADE_MS = 500;
let afterFadeCallbacks: Array<() => void> = [];

function flushAfterFadeCallbacks(): void {
  const callbacks = afterFadeCallbacks;
  afterFadeCallbacks = [];
  callbacks.forEach((callback) => callback());
}

/**
 * Revolut-style release transition: the crossfade doesn't track the finger —
 * it STARTS the moment the drag is released toward a new account and
 * completes in ~0.5s. Mount the target layer and animate to it.
 */
export function releaseThemeDrag(targetTheme: string, fromSurface: string | null): void {
  beginThemeDrag(targetTheme, fromSurface);
  themeDragProgress.value = withTiming(1, { duration: RELEASE_FADE_MS }, (finished) => {
    if (finished) runOnJS(flushAfterFadeCallbacks)();
  });
}

/** Run once the release fade has fully landed (immediately if it has). */
export function runAfterThemeDragFade(callback: () => void): void {
  if (dragTargetTheme === null || themeDragProgress.value >= 0.999) {
    callback();
    return;
  }
  afterFadeCallbacks.push(callback);
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
  themeDragTargetSv.value = null;
  afterFadeCallbacks = [];
  notifyDragListeners();
}

// ---------------------------------------------------------------------------
// Programmatic crossfade (unit switch / menu pick of an image wallpaper):
// the same two-layer pattern as the drag — raise the pre-mounted target
// layer's opacity over the old wallpaper, swap vars once it is opaque, then
// blend the layer away after the base has rendered the new image. Driven by
// its OWN target/progress shared values so an in-flight carousel drag and a
// programmatic switch can never fight over one pair (rapid unit taps
// mid-carousel-drag).
// ---------------------------------------------------------------------------

const CROSSFADE_MS = 350;

/** 0..1 progress toward `themeCrossfadeTargetSv`. */
export const themeCrossfadeProgress = makeMutable(0);
export const themeCrossfadeTargetSv = makeMutable<string | null>(null);

let crossfadeTargetTheme: string | null = null;
let afterCrossfadeCallbacks: Array<() => void> = [];

export function getThemeCrossfadeTarget(): string | null {
  return crossfadeTargetTheme;
}

/** Reuses the drag-target listener set: BackgroundView re-derives its
 *  pre-mounted layer list from BOTH targets on either change. */
export function subscribeThemeCrossfadeTarget(listener: () => void): () => void {
  return subscribeThemeDragTarget(listener);
}

function flushAfterCrossfadeCallbacks(): void {
  const callbacks = afterCrossfadeCallbacks;
  afterCrossfadeCallbacks = [];
  callbacks.forEach((callback) => callback());
}

/**
 * Fade the target theme's (pre-mounted) layer in over the current wallpaper
 * while the surface color glides. Re-targeting mid-fade starts clean, exactly
 * like beginThemeDrag: stale callbacks belong to the abandoned target.
 */
export function startThemeCrossfade(targetTheme: string, fromSurface: string | null): void {
  if (crossfadeTargetTheme !== targetTheme) {
    crossfadeTargetTheme = targetTheme;
    themeCrossfadeTargetSv.value = targetTheme;
    themeCrossfadeProgress.value = 0;
    afterCrossfadeCallbacks = [];
    pendingCrossfadeReleaseTarget = null;
    if (crossfadeFallbackTimer) {
      clearTimeout(crossfadeFallbackTimer);
      crossfadeFallbackTimer = null;
    }
    if (fromSurface) themeSurfaceFrom.value = fromSurface;
    const toSurface = surfaceOfTheme(targetTheme);
    if (toSurface) themeSurfaceTo.value = toSurface;
    notifyDragListeners();
  }
  themeCrossfadeProgress.value = withTiming(1, { duration: CROSSFADE_MS }, (finished) => {
    if (finished) runOnJS(flushAfterCrossfadeCallbacks)();
  });
}

/** Run once the crossfade has fully landed (immediately if it has). */
export function runAfterThemeCrossfade(callback: () => void): void {
  if (crossfadeTargetTheme === null || themeCrossfadeProgress.value >= 0.999) {
    callback();
    return;
  }
  afterCrossfadeCallbacks.push(callback);
}

let pendingCrossfadeReleaseTarget: string | null = null;
let crossfadeFallbackTimer: ReturnType<typeof setTimeout> | null = null;

function releaseCrossfadeNow(): void {
  pendingCrossfadeReleaseTarget = null;
  if (crossfadeFallbackTimer) {
    clearTimeout(crossfadeFallbackTimer);
    crossfadeFallbackTimer = null;
  }
  themeCrossfadeProgress.value = withTiming(0, { duration: RELEASE_BLEND_MS }, (finished) => {
    if (finished) runOnJS(releaseCrossfadeTarget)();
  });
}

function releaseCrossfadeTarget(): void {
  crossfadeTargetTheme = null;
  themeCrossfadeTargetSv.value = null;
  afterCrossfadeCallbacks = [];
  notifyDragListeners();
}

/**
 * Vars are applied and the base sprite now renders the target — blend the
 * crossfade layer away once the base has actually painted the same wallpaper
 * underneath (same event-driven release as the drag).
 */
export function completeThemeCrossfade(): void {
  if (crossfadeTargetTheme === null) return;
  if (lastBaseRenderedTheme === crossfadeTargetTheme) {
    releaseCrossfadeNow();
    return;
  }
  pendingCrossfadeReleaseTarget = crossfadeTargetTheme;
  if (crossfadeFallbackTimer) clearTimeout(crossfadeFallbackTimer);
  crossfadeFallbackTimer = setTimeout(releaseCrossfadeNow, RELEASE_FALLBACK_MS);
}

// ---------------------------------------------------------------------------
// Event-driven release: the drag layer must stay up until the BASE layer has
// actually RENDERED the new wallpaper underneath (the commit's re-render
// storm can delay the base image swap unpredictably — a blind timer either
// wastes time or releases early and flashes whatever is under the layer).
// The base sprite reports each rendered theme via noteBaseWallpaperRendered;
// a generous fallback timer covers load failures.
// ---------------------------------------------------------------------------

const RELEASE_BLEND_MS = 150;
const RELEASE_FALLBACK_MS = 1200;

let pendingReleaseTarget: string | null = null;
let releaseFallbackTimer: ReturnType<typeof setTimeout> | null = null;
let lastBaseRenderedTheme: string | null = null;

/** Called by the base wallpaper sprite whenever it finishes rendering a
 *  theme's image — the signal that the drag layer can safely blend away. */
export function noteBaseWallpaperRendered(theme: string): void {
  lastBaseRenderedTheme = theme;
  if (pendingReleaseTarget && pendingReleaseTarget === theme) {
    releaseNow();
  }
  if (pendingCrossfadeReleaseTarget && pendingCrossfadeReleaseTarget === theme) {
    releaseCrossfadeNow();
  }
}

function releaseNow(): void {
  pendingReleaseTarget = null;
  if (releaseFallbackTimer) {
    clearTimeout(releaseFallbackTimer);
    releaseFallbackTimer = null;
  }
  // Soft blend instead of a snap: if the base is pixel-identical the blend
  // is invisible; if it is a frame behind, this hides the seam.
  themeDragProgress.value = withTiming(0, { duration: RELEASE_BLEND_MS }, (finished) => {
    if (finished) runOnJS(releaseDragTarget)();
  });
}

/**
 * Settled on the target: the base theme now IS the target (vars applied by
 * ThemeProvider) — release the drag layer once the base has rendered the
 * same wallpaper underneath.
 */
export function completeThemeDrag(): void {
  if (dragTargetTheme === null) return;
  if (lastBaseRenderedTheme === dragTargetTheme) {
    releaseNow();
    return;
  }
  pendingReleaseTarget = dragTargetTheme;
  if (releaseFallbackTimer) clearTimeout(releaseFallbackTimer);
  releaseFallbackTimer = setTimeout(releaseNow, RELEASE_FALLBACK_MS);
}
