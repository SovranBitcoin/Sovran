import React, { createContext, useContext, useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useWallpaperStore } from '@/shared/stores/global/wallpaperStore';
import { useThemeStore, type ThemeMode } from '@/shared/stores/profile/themeStore';
import { useUnitWallpaper } from '@/shared/lib/theme/useUnitWallpaper';
import { THEMES, THEME_NAMES, type ThemeName } from '@/themes';
import { log, initLog, useInitMount } from '@/shared/lib/logger';
import { themeVariables, getThemeVariables } from '@/shared/lib/themeEngine';
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
  // Resolve the chrome theme via the shared resolver hook, which subscribes
  // to themeStore (unitWallpapers + activeAlbumSlug) and wallpaperStore
  // (catalog) and walks the fallback chain. Re-renders when any of those
  // references change.
  const currentTheme = useUnitWallpaper();
  const mode = useThemeStore((s) => s.mode);

  const lastApplied = useRef<string | null>(null);

  useEffect(() => {
    if (!THEMES[currentTheme as ThemeName]) {
      log.warn('theme.not_found', { themeName: currentTheme });
      return;
    }
    if (lastApplied.current === currentTheme) return;

    const t0 = performance.now();
    const vars = themeVariables[currentTheme] ?? getThemeVariables(currentTheme);
    Uniwind.updateCSSVariables('light', vars);
    Uniwind.updateCSSVariables('dark', vars);
    const duration_ms = Math.round((performance.now() - t0) * 100) / 100;
    lastApplied.current = currentTheme;
    log.info('theme.css_vars.applied', {
      theme: currentTheme,
      varCount: Object.keys(vars).length,
      duration_ms,
    });
  }, [currentTheme]);

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
