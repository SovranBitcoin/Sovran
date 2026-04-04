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

  const setTheme = (themeName: string) => {
    if (THEMES[themeName as ThemeName]) {
      setCurrentTheme(themeName);
      setThemeStore(themeName);
    } else {
      log.warn('theme.not_found', { themeName });
    }
  };

  useEffect(() => {
    const vars = themeVariables[currentTheme] ?? getThemeVariables(currentTheme);
    Uniwind.updateCSSVariables('light', vars);
    Uniwind.updateCSSVariables('dark', vars);
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
