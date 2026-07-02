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
  completeThemeDrag,
  getThemeDragTarget,
  primeThemeSurface,
  runThemeTransition,
} from '@/shared/lib/theme/themeTransition';
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

  // What consumers SEE. Trails `resolvedTheme` by the fade-out so the
  // wallpaper image and CSS vars swap at the transition's dip, not on the
  // very frame the account changes.
  const [currentTheme, setCurrentTheme] = useState(resolvedTheme);
  const lastApplied = useRef<string | null>(null);

  useEffect(() => {
    if (!THEMES[resolvedTheme as ThemeName]) {
      log.warn('theme.not_found', { themeName: resolvedTheme });
      return;
    }
    if (lastApplied.current === resolvedTheme) return;

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

    if (lastApplied.current === null) {
      // Boot apply — no transition, no fade.
      lastApplied.current = resolvedTheme;
      primeThemeSurface(surfaceOf);
      applyVars();
      return;
    }
    if (getThemeDragTarget() === resolvedTheme) {
      // The carousel drag already crossfaded to this theme — apply instantly
      // under the (fully opaque) drag layer, then release it.
      lastApplied.current = resolvedTheme;
      primeThemeSurface(surfaceOf);
      applyVars();
      completeThemeDrag();
      log.info('theme.transition.drag_completed', { to: resolvedTheme });
      return;
    }
    // Menu pick / programmatic switch: fade the wallpaper layer out, swap at
    // the dip, fade in; the base surface color glides between the themes.
    lastApplied.current = resolvedTheme;
    log.info('theme.transition.start', { to: resolvedTheme });
    runThemeTransition(surfaceOf, applyVars);
  }, [resolvedTheme]);

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
