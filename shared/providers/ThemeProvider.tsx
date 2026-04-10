import React, { createContext, useContext, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { THEMES, THEME_NAMES, type ThemeName } from '@/themes';
import { log } from '@/shared/lib/logger';
import { themeVariables, getThemeVariables } from '@/shared/lib/themeEngine';
import { Uniwind } from 'uniwind';

interface ThemeContextValue {
  currentTheme: string;
  setTheme: (themeName: string) => void;
  availableThemes: ThemeName[];
}

const ThemeContext = createContext<ThemeContextValue>({
  currentTheme: 'dark',
  setTheme: () => {},
  availableThemes: THEME_NAMES,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSettingsStore((state) => state.getTheme());
  const setThemeStore = useSettingsStore((state) => state.setTheme);
  const [currentTheme, setCurrentTheme] = useState(theme || 'dark');

  useEffect(() => {
    if (theme) setCurrentTheme(theme);
  }, [theme]);

  const applyCSSVars = (themeName: string) => {
    const t0 = performance.now();
    const vars = themeVariables[themeName] ?? getThemeVariables(themeName);
    Uniwind.updateCSSVariables('light', vars);
    Uniwind.updateCSSVariables('dark', vars);
    const duration_ms = Math.round((performance.now() - t0) * 100) / 100;
    log.info('theme.css_vars.applied', {
      theme: themeName,
      varCount: Object.keys(vars).length,
      duration_ms,
    });
  };

  const setTheme = (themeName: string) => {
    if (THEMES[themeName as ThemeName]) {
      // Apply CSS vars synchronously BEFORE state update propagates —
      // prevents a 1+ second window where components render with the new
      // background image but old color tokens.
      applyCSSVars(themeName);
      setCurrentTheme(themeName);
      setThemeStore(themeName);
    } else {
      log.warn('theme.not_found', { themeName });
    }
  };

  // Also apply on mount and when store-driven theme changes (e.g. rehydration)
  useEffect(() => {
    applyCSSVars(currentTheme);
  }, [currentTheme]);

  return (
    <ThemeContext.Provider value={{ currentTheme, setTheme, availableThemes: THEME_NAMES }}>
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

export { THEMES };
