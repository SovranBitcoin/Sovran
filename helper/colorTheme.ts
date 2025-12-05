import { vars } from 'nativewind';
import { THEMES } from '../themes';
import {
  backgroundThemeDominantColors,
  backgroundThemeGradientColors,
  isBackgroundImageTheme,
} from '../config/backgroundImageThemes';

/**
 * Shade colors that persist across all themes
 */
const shadeColors = {
  '--color-shade-100': '#FF5841',
  '--color-shade-200': '#FF353C',
  '--color-shade-300': '#ED0C46',
  '--color-shade-400': '#CF014E',
  '--color-shade-500': '#BF004E',
  // Red colors
  '--color-red-100': '#F8E0E6',
  '--color-red-200': '#E4A3B4',
  '--color-red-300': '#ED0C46',
  '--color-red-400': '#BF0A39',
  '--color-red-500': '#9A082E',
  // Green colors
  '--color-green-100': '#E0F8E0',
  '--color-green-200': '#A3E4A3',
  '--color-green-300': '#0CED3E',
  '--color-green-400': '#0ABF35',
  '--color-green-500': '#089A2C',
  // Purple colors
  '--color-purple-100': '#E0E0F8',
  '--color-purple-200': '#A3A3E4',
  '--color-purple-300': '#8A2BE2',
  '--color-purple-400': '#6A0DAD',
  '--color-purple-500': '#4B0082',
};

/**
 * Default fallback colors for non-background-image themes
 * Uses neutral grays as fallback
 */
const defaultDominantColors = {
  '--color-dominant-100': '#666666',
  '--color-dominant-200': '#555555',
  '--color-dominant-300': '#444444',
  '--color-dominant-400': '#333333',
  '--color-dominant-500': '#222222',
};

const defaultGradientColors = {
  '--color-gradient-100': '#888888', // light
  '--color-gradient-200': '#555555', // mid
  '--color-gradient-300': '#222222', // dark
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
    '--color-dominant-100': dominantColors[0]?.hex || '#666666',
    '--color-dominant-200': dominantColors[1]?.hex || '#555555',
    '--color-dominant-300': dominantColors[2]?.hex || '#444444',
    '--color-dominant-400': dominantColors[3]?.hex || '#333333',
    '--color-dominant-500': dominantColors[4]?.hex || '#222222',
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
    '--color-gradient-100': light?.hex || '#888888',
    '--color-gradient-200': mid?.hex || '#555555',
    '--color-gradient-300': dark?.hex || '#222222',
  };
}

/**
 * Convert a palette object to NativeWind CSS variables
 */
function createThemeVars(themeName: string, palette: Record<number, string>) {
  return vars({
    '--color-primary-950': palette[950],
    '--color-primary-900': palette[900],
    '--color-primary-800': palette[800],
    '--color-primary-700': palette[700],
    '--color-primary-600': palette[600],
    '--color-primary-500': palette[500],
    '--color-primary-400': palette[400],
    '--color-primary-300': palette[300],
    '--color-primary-200': palette[200],
    '--color-primary-100': palette[100],
    '--color-primary-50': palette[50],
    '--color-primary-0': palette[0],
    ...shadeColors,
    ...getDominantColorVars(themeName),
    ...getGradientColorVars(themeName),
  });
}

/**
 * Theme variables using CSS variables for dynamic theming.
 * Dynamically generated from THEMES - all themes use their exact name from themes.js
 */
export const colorThemes: Record<string, ReturnType<typeof vars>> = {};

// Generate colorThemes for all themes in THEMES
for (const [themeName, palette] of Object.entries(THEMES)) {
  colorThemes[themeName] = createThemeVars(themeName, palette as Record<number, string>);
}
