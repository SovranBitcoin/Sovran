import { THEMES } from '../themes';
import {
  backgroundThemeDominantColors,
  backgroundThemeGradientColors,
  isBackgroundImageTheme,
} from '../config/backgroundImageThemes';

type ThemeVariables = Record<string, string | number>;
const SHADE_300_HEX = '#ED0C46';

/**
 * Perceived brightness of a hex color (0 = black, 1 = white).
 * Uses the ITU-R BT.601 luma formula.
 */
function hexLuminance(hex: string): number {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Map a 0-950 palette to HeroUI Native's semantic theme variables.
 *
 * Convention in themes.js:
 *   950 = background end   (darkest for dark themes, lightest for light themes)
 *   0   = foreground end   (lightest for dark themes, darkest for light themes)
 */
function getHeroUISemanticVars(palette: Record<number, string>): Record<string, string> {
  const bgIsDark = hexLuminance(palette[950]) < 0.5;
  const accentIsDark = hexLuminance(SHADE_300_HEX) < 0.5;

  return {
    '--background': palette[950],
    '--foreground': palette[0],

    '--surface': palette[900],
    '--surface-foreground': palette[50],
    '--surface-secondary': palette[800],
    '--surface-secondary-foreground': palette[50],
    '--surface-tertiary': palette[700],
    '--surface-tertiary-foreground': palette[100],

    '--overlay': palette[800],
    '--overlay-foreground': palette[50],

    '--muted': palette[400],

    '--default': palette[800],
    '--default-foreground': palette[100],

    // Keep interactive "active" states on the shared shade scale.
    '--accent': palette[500],
    '--accent-foreground': accentIsDark ? palette[0] : palette[950],

    '--segment': palette[900],
    '--segment-foreground': palette[50],

    '--field-background': palette[800],
    '--field-foreground': palette[0],
    '--field-placeholder': palette[400],
    '--field-border': 'transparent',

    '--border': 'transparent',
    '--separator': palette[700],
    '--focus': palette[500],
    '--link': palette[400],

    '--success': '#0CED3E',
    '--success-foreground': bgIsDark ? '#E0F8E0' : '#089A2C',
    '--warning': '#F0C800',
    '--warning-foreground': bgIsDark ? '#FFF8DB' : '#7A6500',
    '--danger': '#ED0C46',
    '--danger-foreground': bgIsDark ? '#F8E0E6' : '#9A082E',

    '--surface-shadow': bgIsDark
      ? '0 0 0 0 transparent inset'
      : '0 2px 4px 0 rgba(0,0,0,0.04), 0 1px 2px 0 rgba(0,0,0,0.06), 0 0 1px 0 rgba(0,0,0,0.06)',
    '--overlay-shadow': bgIsDark
      ? '0 0 1px 0 rgba(255,255,255,0.2) inset'
      : '0 2px 8px 0 rgba(0,0,0,0.02), 0 -6px 12px 0 rgba(0,0,0,0.01), 0 14px 28px 0 rgba(0,0,0,0.03)',
    '--field-shadow': bgIsDark
      ? '0 0 0 0 transparent inset'
      : '0 2px 4px 0 rgba(0,0,0,0.04), 0 1px 2px 0 rgba(0,0,0,0.06), 0 0 1px 0 rgba(0,0,0,0.06)',
  };
}

/**
 * Shade colors that persist across all themes
 */
const shadeColors = {
  '--app-shade-100': '#FF5841',
  '--app-shade-200': '#FF353C',
  '--app-shade-300': SHADE_300_HEX,
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
    ...getHeroUISemanticVars(palette),
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
