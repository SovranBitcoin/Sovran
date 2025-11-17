import React, { createContext, useContext, useState, useEffect } from 'react';
import { View } from 'react-native';
import { THEMES, THEME_NAMES } from '../themes';
import { useSettingsStore } from 'stores/settingsStore';
import { colorThemes } from '../helper/colorTheme';

const ThemeContext = createContext<{
  currentTheme: string;
  setTheme: (themeName: string) => void;
  availableThemes: string[];
  getPrimaryColor: (shade: string, themeName?: string) => string;
  getShadeColor: (shade: string, themeName?: string) => string;
  getRedColor: (shade: string, themeName?: string) => string;
  getGreenColor: (shade: string, themeName?: string) => string;
  getPurpleColor: (shade: string, themeName?: string) => string;
  getYellowColor: (shade: string, themeName?: string) => string;
  primaryColors: Record<number, string>;
}>({
  currentTheme: 'dark',
  setTheme: () => {},
  availableThemes: THEME_NAMES,
  getPrimaryColor: () => '#000000',
  getShadeColor: () => '#000000',
  getRedColor: () => '#000000',
  getGreenColor: () => '#000000',
  getPurpleColor: () => '#000000',
  getYellowColor: () => '#000000',
  primaryColors: {},
});

const getPrimaryColor = (themeName: string, shade: string): string => {
  const colors = THEMES[themeName as keyof typeof THEMES];
  if (!colors) {
    console.warn(`Theme "${themeName}" not found, falling back to dark theme`);
    const darkColors = THEMES['dark'];
    return (darkColors as any)[shade] || '#000000';
  }

  return (colors as any)[shade] || '#000000';
};

const getShadeColor = (themeName: string, shade: string): string => {
  // For now, use the static shades from colors.tsx
  // In the future, this could be theme-specific
  const staticShades = {
    '100': '#FF5841',
    '200': '#FF353C',
    '300': '#ED0C46',
    '400': '#CF014E',
    '500': '#BF004E',
  };

  return staticShades[shade as keyof typeof staticShades] || '#ED0C46';
};

const getRedColor = (themeName: string, shade: string): string => {
  const staticReds = {
    '100': '#F8E0E6',
    '200': '#E4A3B4',
    '300': '#ED0C46',
    '400': '#BF0A39',
    '500': '#9A082E',
  };

  return staticReds[shade as keyof typeof staticReds] || '#ED0C46';
};

const getGreenColor = (themeName: string, shade: string): string => {
  const staticGreens = {
    '100': '#E0F8E0',
    '200': '#A3E4A3',
    '300': '#0CED3E',
    '400': '#0ABF35',
    '500': '#089A2C',
  };

  return staticGreens[shade as keyof typeof staticGreens] || '#0CED3E';
};

const getYellowColor = (themeName: string, shade: string): string => {
  const staticYellows = {
    '100': '#F8F8E0',
    '200': '#E4E4A3',
    '300': '#EDED0C',
    '400': '#BFBF01',
    '500': '#9A9A00',
  };

  return staticYellows[shade as keyof typeof staticYellows] || '#EDED0C';
};

const getPurpleColor = (themeName: string, shade: string): string => {
  const staticPurples = {
    '100': '#E0E0F8',
    '200': '#A3A3E4',
    '300': '#8A2BE2',
    '400': '#6A0DAD',
    '500': '#4B0082',
  };

  return staticPurples[shade as keyof typeof staticPurples] || '#8A2BE2';
};

interface ThemeProviderProps {
  children: React.ReactNode;
  initialTheme?: string;
}

export function ThemeProvider({ children, initialTheme }: ThemeProviderProps) {
  // Get current theme from Zustand store
  const theme = useSettingsStore((state) => state.getTheme());
  const setThemeStore = useSettingsStore((state) => state.setTheme);
  const [currentTheme, setCurrentTheme] = useState(initialTheme || theme || 'dark');

  // Update local state when Zustand theme changes
  useEffect(() => {
    if (theme) {
      setCurrentTheme(theme);
    }
  }, [theme]);

  const setTheme = (themeName: string) => {
    if (THEMES[themeName as keyof typeof THEMES]) {
      setCurrentTheme(themeName);
      setThemeStore(themeName);
    } else {
      console.warn(`Theme "${themeName}" not found in available themes`);
    }
  };

  const getPrimaryColorForShade = (shade: string, themeName?: string) => {
    return getPrimaryColor(themeName || currentTheme, shade);
  };

  const getShadeColorForShade = (shade: string, themeName?: string) => {
    return getShadeColor(themeName || currentTheme, shade);
  };

  const getRedColorForShade = (shade: string, themeName?: string) => {
    return getRedColor(themeName || currentTheme, shade);
  };

  const getGreenColorForShade = (shade: string, themeName?: string) => {
    return getGreenColor(themeName || currentTheme, shade);
  };

  const getPurpleColorForShade = (shade: string, themeName?: string) => {
    return getPurpleColor(themeName || currentTheme, shade);
  };

  const getYellowColorForShade = (shade: string, themeName?: string) => {
    return getYellowColor(themeName || currentTheme, shade);
  };

  // Get primary colors for the current theme
  const primaryColors = THEMES[currentTheme as keyof typeof THEMES] || THEMES['dark'];

  // Get the CSS variables for the current theme
  const getThemeVariables = (themeName: string) => {
    // Map theme names to their variable keys
    const themeMap: Record<string, keyof typeof colorThemes> = {
      navy: 'navy',
      'coral-sunrise': 'coral',
      'ice-queen': 'ice',
      'tropical-forest': 'tropical',
      'desert-dune': 'desert',
      'misty-morning': 'misty',
      'neon-dream': 'neon',
      'cosmic-ember': 'cosmic',
      'digital-oasis': 'digital',
      'celestial-aura': 'celestial',
      'urban-concrete': 'urban',
      'volcanic-crimson': 'volcanic',
      'crimson-night': 'crimson',
      'velvet-emerald': 'velvet',
      'twilight-amber': 'twilight',
      'retro-outrun': 'retro',
      'light-beige': 'lightbeige',
      beige: 'beige',
      'middle-beige': 'middlebeige',
      light: 'light',
      forest: 'forest',
      sunset: 'sunset',
      ocean: 'ocean',
      'dark-grey': 'darkgrey',
      'slate-shadow': 'slate',
      'mystic-fog': 'mystic',
      'eclipse-steel': 'eclipse',
      'aurora-twilight': 'aurora',
      rose: 'rose',
      autumn: 'autumn',
      dark: 'dark',
      // Background Image Themes - now using human names directly
      deepocean: 'deepocean',
      cosmicpurple: 'cosmicpurple',
      mysticblue: 'mysticblue',
      royalpurple: 'royalpurple',
    };

    const themeKey = themeMap[themeName] || 'dark';
    return colorThemes[themeKey];
  };

  return (
    <ThemeContext.Provider
      value={{
        currentTheme,
        setTheme,
        availableThemes: THEME_NAMES,
        getPrimaryColor: getPrimaryColorForShade,
        getShadeColor: getShadeColorForShade,
        getRedColor: getRedColorForShade,
        getGreenColor: getGreenColorForShade,
        getPurpleColor: getPurpleColorForShade,
        getYellowColor: getYellowColorForShade,
        primaryColors,
      }}>
      <View style={getThemeVariables(currentTheme)} className="flex-1">
        {children}
      </View>
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

// Export the THEMES for direct access if needed
export { THEMES, THEME_NAMES };
