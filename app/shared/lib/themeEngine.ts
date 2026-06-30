import { THEMES, type ThemeName, type ThemePalette } from '@/themes';
import {
  backgroundThemeDominantColors,
  backgroundThemeGradientColors,
  isBackgroundImageTheme,
} from '@/config/backgroundImageThemes';

type SemanticVars = Record<string, string>;

/**
 * Static color scales — constant across all themes.
 * Hex values declared once here, then expanded into both:
 *   --shade-100  (base var for global.css @theme var() references)
 *   --color-shade-100  (Tailwind token resolved by useCSSVariable / useColor)
 *
 * Uniwind's runtime does NOT follow var() chains, so both forms are needed.
 */
const STATIC_COLOR_VALUES: Record<string, string> = {
  // shade-* mirrors the blue ramp (the brand-neutral). shade-0 and -50
  // are near-white surface tints; -100 through -500 match blue-100..500.
  'shade-0': '#F8FAFC',
  'shade-50': '#F0F6FC',
  'shade-100': '#E0EEFA',
  'shade-200': '#95C5EA',
  'shade-300': '#2A7AD0',
  'shade-400': '#1F5BA0',
  'shade-500': '#143E70',

  // Color ramps for a finance UI, anchored on Apple System Colors so the
  // semantic registers (positive/negative/warning/info) read as the same
  // visual language users see daily in Wallet, Stocks, and Messages.
  // Each ramp follows a consistent shape: a near-white tint at 100, a
  // pastel at 200, the canonical brand color at 300, a deeper variant at
  // 400, and a deep AA-text-safe shade at 500. Saturation is held in a
  // ~55–75% band — never neon, never washed out.

  // Reds use Tailwind's red ramp (hue 0° — pure red, neither orange nor
  // pink). Apple System Red (#FF3B30) is hue 3° and reads as too orange
  // alongside the Apple greens/blues anchored elsewhere; the original
  // #ED0C46 was hue 343° and read as too pink. Tailwind red sits at
  // neutral hue 0° and is the de-facto "danger" red across heroui /
  // shadcn / radix component libraries the app composes with.
  'red-100': '#FEE2E2',
  'red-200': '#FECACA',
  'red-300': '#EF4444',
  'red-400': '#DC2626',
  'red-500': '#991B1B',

  // Greens anchored on Apple System Green (#34C759) — the universal
  // "trustworthy positive / verified" register. Replaced #0CED3E (90%
  // sat, highlighter) which failed WCAG AA on light backgrounds.
  'green-100': '#E8F8EE',
  'green-200': '#A8E0BD',
  'green-300': '#34C759',
  'green-400': '#2DA84B',
  'green-500': '#1F7A38',

  // Purples anchored on Apple System Purple (#AF52DE). Previous ramp
  // had a hue jump (pastel blue-violet at 200 → red-violet at 300), so
  // mid-tones drifted as you went up the scale; this ramp holds hue.
  'purple-100': '#F4E8FB',
  'purple-200': '#DDB8F0',
  'purple-300': '#AF52DE',
  'purple-400': '#8E3BB8',
  'purple-500': '#5F1F88',

  // Blues at the Apple-blue hue (~212°) but desaturated to match the
  // green ramp's ~58% saturation profile. Apple System Blue (#007AFF)
  // at full 100% saturation visibly out-shouted the green when the two
  // sat next to each other — bringing blue to ~67% sat keeps the iOS
  // "interactive / link / info" register without making it the loudest
  // color on the screen. The `shade-*` ramp above mirrors these values.
  'blue-100': '#E0EEFA',
  'blue-200': '#95C5EA',
  'blue-300': '#2A7AD0',
  'blue-400': '#1F5BA0',
  'blue-500': '#143E70',

  // Yellows shifted to amber territory (~hue 45°) and desaturated from
  // Apple System Yellow's 100% sat to ~75% so they don't out-shout the
  // green ramp. Pure yellow at lower saturation reads as olive/mustard
  // very quickly; the slight warm shift to amber gives the ramp room
  // to breathe without losing the "caution" register. The previous
  // #FFCC00 sat at LCH chroma ~90 vs green's ~63 — too loud next to it.
  'yellow-100': '#FCF0CC',
  'yellow-200': '#F1DA8F',
  'yellow-300': '#E0B229',
  'yellow-400': '#B0871E',
  'yellow-500': '#6E5410',

  // Oranges KEPT on Bitcoin Orange (#F7931A) at 300 — culturally
  // load-bearing for a Bitcoin/Cashu wallet; the rest of the ramp is
  // already hue-coherent with it. Do NOT swap to Apple System Orange.
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

  return {
    '--background': palette[950],
    '--foreground': palette[0],

    '--surface': palette[900],
    '--surface-foreground': palette[50],
    '--surface-secondary': palette[800],
    '--surface-secondary-foreground': palette[50],
    '--surface-tertiary': palette[700],
    '--surface-tertiary-foreground': palette[100],

    // Aliased to `--surface` so menu-lane surfaces (heroui Menu/BottomSheet/
    // Dialog/Popover/Sub-menu, plus PopupHost's custom snapPoints sheets) sit
    // at the same depth as the drawer and the page canvas. `--surface-
    // secondary` (palette[800]) remains the next layer up for cards that need
    // to stand out from the canvas they're on.
    '--overlay': palette[900],
    '--overlay-foreground': palette[50],

    '--muted': palette[400],

    '--default': palette[700],
    '--default-foreground': palette[100],

    '--accent': palette[0],
    '--accent-foreground': palette[950],

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

    // Semantic tokens point at the canonical "300" of each ramp; the
    // foreground variant pairs with the surface theme: 200-tier on dark
    // for high-contrast pastel text, 500-tier on light for AA-safe ink.
    '--success': '#34C759', // green-300, Apple System Green
    '--success-foreground': bgIsDark ? '#A8E0BD' : '#1F7A38',
    '--warning': '#E0B229', // yellow-300, amber (chroma-matched to green)
    '--warning-foreground': bgIsDark ? '#F1DA8F' : '#6E5410',
    '--danger': '#EF4444', // red-300, Tailwind red-500
    '--danger-foreground': bgIsDark ? '#FECACA' : '#991B1B',

    '--surface-shadow': bgIsDark
      ? '0 0 0 0 transparent inset'
      : '0 2px 4px 0 rgba(0,0,0,0.04), 0 1px 2px 0 rgba(0,0,0,0.06), 0 0 1px 0 rgba(0,0,0,0.06)',
    // Dark theme uses a 1 px inset white highlight to lift the menu off the
    // canvas. Light theme inverts the concept — instead of a dark drop-
    // shadow (which read as a muddy halo on a near-white menu sitting on a
    // near-white canvas), it stacks a bright inner edge with a wide white
    // outer glow, plus a hairline 4 %-black ring for separation. Net effect:
    // the menu feels lit from within rather than casting a shadow.
    '--overlay-shadow': bgIsDark
      ? '0 0 1px 0 rgba(255,255,255,0.2) inset'
      : '0 0 1px 0 rgba(255,255,255,1) inset, 0 0 24px 4px rgba(255,255,255,0.8), 0 0 0 1px rgba(0,0,0,0.04)',
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
