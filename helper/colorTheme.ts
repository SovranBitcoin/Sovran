import { THEMES } from '../themes';
import {
  backgroundThemeDominantColors,
  backgroundThemeGradientColors,
  isBackgroundImageTheme,
} from '../config/backgroundImageThemes';

type ThemeVariables = Record<string, string | number>;

/**
 * Shade colors that persist across all themes
 */
const shadeColors = {
  '--app-shade-100': '#FF5841',
  '--app-shade-200': '#FF353C',
  '--app-shade-300': '#ED0C46',
  '--app-shade-400': '#CF014E',
  '--app-shade-500': '#BF004E',
  // Red colors
  '--app-red-100': '#F8E0E6',
  '--app-red-200': '#E4A3B4',
  '--app-red-300': '#ED0C46',
  '--app-red-400': '#BF0A39',
  '--app-red-500': '#9A082E',
  // Green colors
  '--app-green-100': '#E0F8E0',
  '--app-green-200': '#A3E4A3',
  '--app-green-300': '#0CED3E',
  '--app-green-400': '#0ABF35',
  '--app-green-500': '#089A2C',
  // Purple colors
  '--app-purple-100': '#E0E0F8',
  '--app-purple-200': '#A3A3E4',
  '--app-purple-300': '#8A2BE2',
  '--app-purple-400': '#6A0DAD',
  '--app-purple-500': '#4B0082',
};

/**
 * Default fallback colors for non-background-image themes
 * Uses neutral grays as fallback
 */
const defaultDominantColors = {
  '--app-dominant-100': '#666666',
  '--app-dominant-200': '#555555',
  '--app-dominant-300': '#444444',
  '--app-dominant-400': '#333333',
  '--app-dominant-500': '#222222',
};

const defaultGradientColors = {
  '--app-gradient-100': '#888888', // light
  '--app-gradient-200': '#555555', // mid
  '--app-gradient-300': '#222222', // dark
};

/**
 * Get dominant color CSS variables for a theme
 * Maps 5 dominant colors to 100-500 scale
 */
function getDominantColorVars(themeName: string): Record<string, string> {
  if (!isBackgroundImageTheme(themeName)) {
    return defaultDominantColors;
  }

  const dominantColors = backgroundThemeDominantColors[themeName];
  if (!dominantColors || dominantColors.length === 0) {
    return defaultDominantColors;
  }

  return {
    '--app-dominant-100': dominantColors[0]?.hex || '#666666',
    '--app-dominant-200': dominantColors[1]?.hex || '#555555',
    '--app-dominant-300': dominantColors[2]?.hex || '#444444',
    '--app-dominant-400': dominantColors[3]?.hex || '#333333',
    '--app-dominant-500': dominantColors[4]?.hex || '#222222',
  };
}

/**
 * Get gradient color CSS variables for a theme
 * Maps 3 gradient colors (light, mid, dark) to 100-300 scale
 */
function getGradientColorVars(themeName: string): Record<string, string> {
  if (!isBackgroundImageTheme(themeName)) {
    return defaultGradientColors;
  }

  const gradientColors = backgroundThemeGradientColors[themeName];
  if (!gradientColors || gradientColors.length === 0) {
    return defaultGradientColors;
  }

  // Find colors by position, fallback to index
  const light = gradientColors.find((c) => c.position === 'light') || gradientColors[0];
  const mid = gradientColors.find((c) => c.position === 'mid') || gradientColors[1];
  const dark = gradientColors.find((c) => c.position === 'dark') || gradientColors[2];

  return {
    '--app-gradient-100': light?.hex || '#888888',
    '--app-gradient-200': mid?.hex || '#555555',
    '--app-gradient-300': dark?.hex || '#222222',
  };
}

/**
 * Convert a palette object to runtime CSS variables for Uniwind.
 */
function createThemeVars(themeName: string, palette: Record<number, string>): ThemeVariables {
  return {
    '--app-primary-950': palette[950],
    '--app-primary-900': palette[900],
    '--app-primary-800': palette[800],
    '--app-primary-700': palette[700],
    '--app-primary-600': palette[600],
    '--app-primary-500': palette[500],
    '--app-primary-400': palette[400],
    '--app-primary-300': palette[300],
    '--app-primary-200': palette[200],
    '--app-primary-100': palette[100],
    '--app-primary-50': palette[50],
    '--app-primary-0': palette[0],
    ...shadeColors,
    ...getDominantColorVars(themeName),
    ...getGradientColorVars(themeName),
  };
}

/**
 * Theme variables using CSS variables for dynamic theming.
 * Dynamically generated from THEMES - all themes use their exact name from themes.js
 */
export const colorThemes: Record<string, ThemeVariables> = {};

// Generate colorThemes for all themes in THEMES
for (const [themeName, palette] of Object.entries(THEMES)) {
  colorThemes[themeName] = createThemeVars(themeName, palette as Record<number, string>);
}
