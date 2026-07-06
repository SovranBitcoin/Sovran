/**
 * Theme/wallpaper transition seam (module-level reanimated mutables so
 * ThemeProvider — which mounts ABOVE BackgroundProvider — can drive layers
 * that BackgroundView renders, without provider-order gymnastics).
 *
 * The wallpaper is a stack of PERSISTENT per-carousel-page layers whose
 * opacities are a pure function of one shared value: the account pager's
 * continuous position (`carouselX`). There is no fake→real handoff — the
 * layer that fades in during a drag simply IS the wallpaper afterwards, so
 * rapid back-and-forth swipes can't desync and nothing waits on an image
 * reload to release an overlay.
 *
 * Non-carousel wallpaper changes (menu pick, album apply, profile switch)
 * go through a single snapshot-cover layer instead; color-only themes keep
 * the fade-through-surface transition.
 */

import { makeMutable, runOnJS, withTiming } from 'react-native-reanimated';
import { themeVariables, getThemeVariables } from '@/shared/lib/themeEngine';

const FADE_OUT_MS = 160;
const FADE_IN_MS = 260;
const COLOR_MS = 420;

/** Multiplied into the wallpaper stack's opacity (color-only theme dip). */
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
 * the carousel stack or `coverWallpaperChange` instead — dipping a
 * full-bleed photo to a solid color and back reads as a flash.
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
// Carousel wallpaper stack: the account pager registers its pages (one unit +
// resolved wallpaper theme per page) and streams its continuous position into
// `carouselX` from an onPageScroll worklet. BackgroundView renders one
// persistent layer per page; each layer's opacity derives from carouselX
// alone, so drags, cancels, retargets, and programmatic setPage animations
// are all correct with zero transition state.
// ---------------------------------------------------------------------------

/** Continuous pager position (pageIndex + drag fraction), clamped at write. */
export const carouselX = makeMutable(0);

interface CarouselPage {
  unit: string;
  theme: string;
}

let carouselPages: CarouselPage[] = [];
const wallpaperListeners = new Set<() => void>();

function notifyWallpaperListeners(): void {
  wallpaperListeners.forEach((listener) => listener());
}

/** BackgroundView re-derives its layer list on page or overlay changes. */
export function subscribeWallpaperLayers(listener: () => void): () => void {
  wallpaperListeners.add(listener);
  return () => {
    wallpaperListeners.delete(listener);
  };
}

export function getCarouselPages(): CarouselPage[] {
  return carouselPages;
}

/** Register the pager's pages (order = page order). Dedupes by value so
 *  identity-churning `availableUnits` arrays don't rebuild the layer stack. */
export function setCarouselPages(pages: CarouselPage[]): void {
  const unchanged =
    pages.length === carouselPages.length &&
    pages.every(
      (page, i) => page.unit === carouselPages[i].unit && page.theme === carouselPages[i].theme
    );
  if (unchanged) return;
  carouselPages = pages;
  notifyWallpaperListeners();
}

/** Is this theme currently one of the carousel's page wallpapers? When true,
 *  a unit-driven theme change needs no overlay — the page stack already
 *  shows (or is animating to) it. */
export function isCarouselTheme(theme: string): boolean {
  return carouselPages.some((page) => page.theme === theme);
}

/**
 * Layer opacity as a pure function of the pager position. Layers stack in
 * page order (page 0 bottom … page N top): the floor page holds opacity 1
 * underneath while the page above fades in with the drag fraction — a
 * top-layer-only crossfade, so the surface color never bleeds through
 * mid-blend (fading both layers dips the composite toward the backdrop).
 */
export function carouselLayerOpacity(x: number, pageIndex: number, pageCount: number): number {
  'worklet';
  const maxIndex = pageCount - 1;
  const clamped = x < 0 ? 0 : x > maxIndex ? maxIndex : x;
  const distance = clamped - pageIndex;
  if (distance >= 0 && distance < 1) return 1; // floor layer (or settled)
  if (distance > -1 && distance < 0) return 1 + distance; // fading in on top
  return 0;
}

// ---------------------------------------------------------------------------
// Programmatic cover (menu pick / album apply / profile switch — any image
// wallpaper change NOT driven by the pager): a snapshot layer of the
// OUTGOING wallpaper mounts above the page stack at full opacity — invisible,
// it is pixel-identical to what is already on screen — so the vars can swap
// and the layers underneath can re-point and decode freely. Once a layer
// below has actually rendered the target image, the cover dissolves over it.
// One animation, no callback queue, and nothing to strand if the change is
// superseded mid-flight (the cover just keeps covering).
// ---------------------------------------------------------------------------

const COVER_DISSOLVE_MS = 350;
const COVER_FALLBACK_MS = 1200;

/** Cover layer opacity (1 while covering, dissolves to 0 on release). */
export const overlayProgress = makeMutable(0);

let coverTheme: string | null = null;
let coverTargetTheme: string | null = null;
let coverStartSeq = 0;
let coverFallbackTimer: ReturnType<typeof setTimeout> | null = null;

/** Monotonic stamp per rendered theme, so the cover only releases on a
 *  render that happened AFTER it mounted — a stale render of the target
 *  from some earlier switch must not drop the cover early. */
let renderSeq = 0;
const renderedSeqByTheme = new Map<string, number>();

export function getWallpaperOverlayTheme(): string | null {
  return coverTheme;
}

function clearCoverFallbackTimer(): void {
  if (coverFallbackTimer) {
    clearTimeout(coverFallbackTimer);
    coverFallbackTimer = null;
  }
}

/**
 * Cover the wallpaper with `previousTheme` (what is on screen right now) and
 * hold until a layer underneath renders `targetTheme`, then dissolve. Callers
 * apply the CSS vars immediately after — the swap happens under the cover.
 * Re-targeting mid-cover keeps the ORIGINAL snapshot (still what the user is
 * looking at) and just moves the release condition to the new target.
 */
export function coverWallpaperChange(previousTheme: string, targetTheme: string): void {
  if (coverTheme === null) {
    coverTheme = previousTheme;
    overlayProgress.value = 1;
    notifyWallpaperListeners();
  }
  coverTargetTheme = targetTheme;
  coverStartSeq = renderSeq;
  clearCoverFallbackTimer();
  coverFallbackTimer = setTimeout(releaseCoverNow, COVER_FALLBACK_MS);
}

function releaseCoverNow(): void {
  coverTargetTheme = null;
  clearCoverFallbackTimer();
  overlayProgress.value = withTiming(0, { duration: COVER_DISSOLVE_MS }, (finished) => {
    if (finished) runOnJS(unmountCover)();
  });
}

function unmountCover(): void {
  coverTheme = null;
  notifyWallpaperListeners();
}

/** Called by every wallpaper sprite when it finishes rendering a theme's
 *  image — the signal that the cover can safely dissolve. */
export function noteWallpaperRendered(theme: string): void {
  renderSeq += 1;
  renderedSeqByTheme.set(theme, renderSeq);
  if (coverTargetTheme === theme && (renderedSeqByTheme.get(theme) ?? 0) > coverStartSeq) {
    releaseCoverNow();
  }
}
