import { vars } from 'nativewind';
import { THEMES } from '../themes';

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
 * Convert a palette object to NativeWind CSS variables
 */
function createThemeVars(palette: Record<number, string>) {
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
  });
}

/**
 * Theme variables using CSS variables for dynamic theming.
 * Dynamically generated from THEMES - all themes use their exact name from themes.js
 */
export const colorThemes: Record<string, ReturnType<typeof vars>> = {};

// Generate colorThemes for all themes in THEMES
for (const [themeName, palette] of Object.entries(THEMES)) {
  colorThemes[themeName] = createThemeVars(palette as Record<number, string>);
}
