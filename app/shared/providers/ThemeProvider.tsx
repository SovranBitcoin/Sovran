import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useWallpaperStore } from '@/shared/stores/global/wallpaperStore';
import { useThemeStore, type ThemeMode } from '@/shared/stores/profile/themeStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useUnitWallpaper } from '@/shared/lib/theme/useUnitWallpaper';
import { THEMES, THEME_NAMES, type ThemeName } from '@/themes';
import { log, initLog, useInitMount } from '@/shared/lib/logger';
import { themeVariables, getThemeVariables } from '@/shared/lib/themeEngine';
import {
  coverWallpaperChange,
  isCarouselTheme,
  primeThemeSurface,
  runThemeTransition,
} from '@/shared/lib/theme/themeTransition';
import { isBackgroundImageTheme } from '@/config/backgroundImageThemes';
import { Uniwind } from 'uniwind';

initLog('Module', 'ThemeProvider loaded');

interface ThemeContextValue {
  currentTheme: string;
  mode: ThemeMode;
  availableThemes: ThemeName[];
}

const ThemeContext = createContext<ThemeContextValue>({
  currentTheme: 'dark',
  mode: 'dark',
  availableThemes: THEME_NAMES,
});

/**
 * Resolves the chrome theme for the whole app from the profile-scoped
 * `themeStore`: walks the resolver fallback chain and returns a theme name
 * that exists in THEMES. Gates first render on both the wallpaper store
 * (downloaded themes registered) and the theme store (profile overrides
 * loaded) — missing either would flash the built-in fallback.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useInitMount('ThemeProvider');
  // Only gate on wallpaperStore — it's a global store and always hydrates.
  // themeStore is profile-scoped and its hydration is gated on
  // `_migrationGate`, which signals AFTER AccountScopedProviders mounts
  // lower in the tree. Gating ThemeProvider on themeStore._hasHydrated
  // here would deadlock the splash screen.
  const wallpaperHydrated = useWallpaperStore((s) => s._hasHydrated);
  // The chrome theme follows the ACTIVE WALLET UNIT: switching the wallet to
  // usd applies the wallpaper assigned to usd (unit-scoped assignment inside
  // the profile). Read the persisted unit straight from mintStore — this
  // provider mounts above CocoProvider, so the coco-aware availability hook
  // isn't reachable here, and the persisted choice is the right key even
  // while coco boots. Falls through resolveUnitWallpaper's chain (unit →
  // first override → album → fallback) when the unit has no assignment.
  const activeUnit = useMintStore((s) => s.activeUnit);
  const resolvedTheme = useUnitWallpaper(activeUnit);
  const mode = useThemeStore((s) => s.mode);

  // What consumers SEE. On programmatic wallpaper changes it trails
  // `resolvedTheme` until the overlay covers the swap; on carousel-driven
  // changes it applies immediately (the page stack already shows the
  // wallpaper, so there is nothing to hide).
  const [currentTheme, setCurrentTheme] = useState(resolvedTheme);
  const lastApplied = useRef<string | null>(null);
  const lastAppliedUnit = useRef<string | null>(null);

  useEffect(() => {
    if (!THEMES[resolvedTheme as ThemeName]) {
      log.warn('theme.not_found', { themeName: resolvedTheme });
      return;
    }
    if (lastApplied.current === resolvedTheme) {
      lastAppliedUnit.current = activeUnit;
      return;
    }

    const applyVars = () => {
      const t0 = performance.now();
      const vars = themeVariables[resolvedTheme] ?? getThemeVariables(resolvedTheme);
      Uniwind.updateCSSVariables('light', vars);
      Uniwind.updateCSSVariables('dark', vars);
      const duration_ms = Math.round((performance.now() - t0) * 100) / 100;
      log.info('theme.css_vars.applied', {
        theme: resolvedTheme,
        varCount: Object.keys(vars).length,
        duration_ms,
      });
      setCurrentTheme(resolvedTheme);
    };
    const surfaceOf =
      ((themeVariables[resolvedTheme] ?? getThemeVariables(resolvedTheme))['--surface'] as
        | string
        | undefined) ?? null;

    const unitChanged = lastAppliedUnit.current !== activeUnit;
    lastAppliedUnit.current = activeUnit;

    if (lastApplied.current === null) {
      // Boot apply — no transition, no fade.
      lastApplied.current = resolvedTheme;
      primeThemeSurface(surfaceOf);
      applyVars();
      return;
    }
    const previousTheme = lastApplied.current;
    lastApplied.current = resolvedTheme;
    if (unitChanged && isCarouselTheme(resolvedTheme)) {
      // Unit switch with the account carousel mounted: the wallpaper layer
      // stack already shows (or is animating to) this page's wallpaper —
      // apply the vars right away. No queue, so a rapid drag back can never
      // strand the vars behind an abandoned fade.
      primeThemeSurface(surfaceOf);
      applyVars();
      log.info('theme.transition.carousel_applied', { to: resolvedTheme });
      return;
    }
    if (isBackgroundImageTheme(resolvedTheme)) {
      // Programmatic image-wallpaper change (menu pick / album apply /
      // profile switch): snapshot-cover the outgoing wallpaper, swap the
      // vars under it, and dissolve once a layer underneath has rendered
      // the new image — never dip through the surface color (the dip reads
      // as a flash), and never let the stack re-point in plain sight.
      log.info('theme.transition.start', { to: resolvedTheme, kind: 'cover' });
      coverWallpaperChange(previousTheme, resolvedTheme);
      primeThemeSurface(surfaceOf);
      applyVars();
      return;
    }
    // Color-only target: there is no image to crossfade to — fade the
    // wallpaper layer out, swap at the dip, fade in; the base surface color
    // glides between the themes.
    log.info('theme.transition.start', { to: resolvedTheme, kind: 'fade' });
    runThemeTransition(surfaceOf, applyVars);
  }, [resolvedTheme, activeUnit]);

  // Wait for the wallpaper store to finish registering downloaded themes —
  // without this the first paint would render against unregistered THEMES
  // and flash the built-in fallback.
  if (!wallpaperHydrated) return null;

  return (
    <ThemeContext.Provider
      value={{ currentTheme, mode, availableThemes: Object.keys(THEMES) as ThemeName[] }}>
      <View className="flex-1">{children}</View>
    </ThemeContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
};
