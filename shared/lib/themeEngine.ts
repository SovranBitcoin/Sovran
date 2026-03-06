import { THEMES, type ThemeName, type ThemePalette } from '@/themes';
import {
  backgroundThemeDominantColors,
  backgroundThemeGradientColors,
  isBackgroundImageTheme,
} from '@/config/backgroundImageThemes';

export type SemanticVars = Record<string, string>;

const SHADE_300_HEX = '#ED0C46';

/**
 * Static color scales — constant across all themes.
 * Hex values declared once here, then expanded into both:
 *   --shade-100  (base var for global.css @theme var() references)
 *   --color-shade-100  (Tailwind token resolved by useCSSVariable / useColor)
 *
 * Uniwind's runtime does NOT follow var() chains, so both forms are needed.
 */
const STATIC_COLOR_VALUES: Record<string, string> = {
  'shade-100': '#FF5841',
  'shade-200': '#FF353C',
  'shade-300': '#ED0C46',
  'shade-400': '#CF014E',
  'shade-500': '#BF004E',

  'red-100': '#F8E0E6',
  'red-200': '#E4A3B4',
  'red-300': '#ED0C46',
  'red-400': '#BF0A39',
  'red-500': '#9A082E',

  'green-100': '#E0F8E0',
  'green-200': '#A3E4A3',
  'green-300': '#0CED3E',
  'green-400': '#0ABF35',
  'green-500': '#089A2C',

  'purple-100': '#E0E0F8',
  'purple-200': '#A3A3E4',
  'purple-300': '#8A2BE2',
  'purple-400': '#6A0DAD',
  'purple-500': '#4B0082',

  'blue-100': '#DBEAFE',
  'blue-200': '#93C5FD',
  'blue-300': '#3B82F6',
  'blue-400': '#2563EB',
  'blue-500': '#1D4ED8',

  'yellow-100': '#F8F8E0',
  'yellow-200': '#E4E4A3',
  'yellow-300': '#EDED0C',
  'yellow-400': '#BFBF01',
  'yellow-500': '#9A9A00',

  'orange-100': '#FEF0DC',
  'orange-200': '#FCC46A',
  'orange-300': '#F7931A',
  'orange-400': '#C87614',
  'orange-500': '#9A5A0F',
};

const STATIC_COLORS: SemanticVars = Object.fromEntries(
  Object.entries(STATIC_COLOR_VALUES).flatMap(([name, hex]) => [
    [`--${name}`, hex],
    [`--color-${name}`, hex],
  ])
);

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
 * Convention in themes.ts:
 *   950 = background end   (darkest for dark themes, lightest for light themes)
 *   0   = foreground end   (lightest for dark themes, darkest for light themes)
 */
function buildSemanticVars(palette: ThemePalette): SemanticVars {
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

    '--default': palette[700],
    '--default-foreground': palette[100],

    '--accent': STATIC_COLOR_VALUES['shade-300'],
    '--accent-foreground': accentIsDark ? palette[0] : palette[950],

    '--skeleton': palette[500],
    '--color-skeleton': palette[500],

    '--segment': palette[900],
    '--segment-foreground': palette[50],

    '--field-background': palette[900],
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

function getDominantVars(themeName: string): SemanticVars {
  const fallback: SemanticVars = {
    '--dominant-100': '#666666',
    '--dominant-200': '#555555',
    '--dominant-300': '#444444',
    '--dominant-400': '#333333',
    '--dominant-500': '#222222',
  };

  if (!isBackgroundImageTheme(themeName)) return fallback;

  const colors = backgroundThemeDominantColors[themeName];
  if (!colors?.length) return fallback;

  return {
    '--dominant-100': colors[0]?.hex ?? '#666666',
    '--dominant-200': colors[1]?.hex ?? '#555555',
    '--dominant-300': colors[2]?.hex ?? '#444444',
    '--dominant-400': colors[3]?.hex ?? '#333333',
    '--dominant-500': colors[4]?.hex ?? '#222222',
  };
}

function getGradientVars(themeName: string): SemanticVars {
  const fallback: SemanticVars = {
    '--gradient-100': '#888888',
    '--gradient-200': '#555555',
    '--gradient-300': '#222222',
  };

  if (!isBackgroundImageTheme(themeName)) return fallback;

  const colors = backgroundThemeGradientColors[themeName];
  if (!colors?.length) return fallback;

  const light = colors.find((c) => c.position === 'light') ?? colors[0];
  const mid = colors.find((c) => c.position === 'mid') ?? colors[1];
  const dark = colors.find((c) => c.position === 'dark') ?? colors[2];

  return {
    '--gradient-100': light?.hex ?? '#888888',
    '--gradient-200': mid?.hex ?? '#555555',
    '--gradient-300': dark?.hex ?? '#222222',
  };
}

/**
 * Build the full set of CSS variables for a given theme.
 * Includes static color scales + HeroUI semantic vars + wallpaper vars.
 * All values are registered with Uniwind so both className and useColor work.
 */
export function getThemeVariables(themeName: string): SemanticVars {
  const palette = THEMES[themeName as ThemeName];
  if (!palette) {
    return getThemeVariables('dark');
  }

  return {
    ...STATIC_COLORS,
    ...buildSemanticVars(palette),
    ...getDominantVars(themeName),
    ...getGradientVars(themeName),
  };
}

/** Pre-computed theme variables for every known theme. */
export const themeVariables: Record<string, SemanticVars> = Object.fromEntries(
  Object.keys(THEMES).map((name) => [name, getThemeVariables(name)])
);
