/**
 * Wallpaper render-state store.
 *
 * Tracks, per theme name, whether its background image has actually decoded and
 * painted (`onLoad`) or failed (`onError`) in `SpriteView`. This is distinct
 * from `themeStore.activeAlbumSlug` (the persisted selection) and from a theme
 * merely being registered in `backgroundImageThemes` (an image source exists) —
 * it is the only signal that the wallpaper is genuinely on screen.
 *
 * Exists because a download can register a truncated/empty file that later
 * fails to decode and renders the background black; a test that asserted only
 * the persisted slug (or a registered source) passed while the wallpaper was
 * invisible. `WalletWallpaperProbe` exposes this so e2e can assert the real
 * render.
 */
import { create } from 'zustand';

type WallpaperRenderStatus = 'loaded' | 'failed';

interface WallpaperRenderState {
  statusByTheme: Record<string, WallpaperRenderStatus>;
  markLoaded: (theme: string) => void;
  markFailed: (theme: string) => void;
}

export const useWallpaperRenderStore = create<WallpaperRenderState>((set) => ({
  statusByTheme: {},
  markLoaded: (theme) =>
    set((s) =>
      s.statusByTheme[theme] === 'loaded'
        ? s
        : { statusByTheme: { ...s.statusByTheme, [theme]: 'loaded' } }
    ),
  markFailed: (theme) =>
    set((s) =>
      s.statusByTheme[theme] === 'failed'
        ? s
        : { statusByTheme: { ...s.statusByTheme, [theme]: 'failed' } }
    ),
}));

/** Non-hook accessors for the SpriteView image callbacks. */
export function markWallpaperLoaded(theme: string): void {
  useWallpaperRenderStore.getState().markLoaded(theme);
}
export function markWallpaperFailed(theme: string): void {
  useWallpaperRenderStore.getState().markFailed(theme);
}
