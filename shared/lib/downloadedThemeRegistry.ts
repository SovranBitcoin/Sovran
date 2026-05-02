// ---------------------------------------------------------------------------
// Downloaded Theme Registry
//
// Dynamically registers downloaded wallpaper themes into the theme engine's
// mutable registries (THEMES, themeVariables, backgroundImageThemes, etc.)
// at runtime. All registries are plain objects/arrays — mutations are valid.
// ---------------------------------------------------------------------------

import { THEMES, type ThemePalette } from '@/themes';
import { themeVariables, getThemeVariables } from '@/shared/lib/themeEngine';
import {
  backgroundImageThemes,
  BACKGROUND_THEME_NAMES,
  backgroundThemeDisplayNames,
  backgroundThemeDominantColors,
  backgroundThemeGradientColors,
  type DominantColor,
  type GradientColor,
} from '@/config/backgroundImageThemes';
import { log } from '@/shared/lib/logger';

// Capture bundled theme names at module load (before any dynamic registration)
const BUNDLED_THEME_NAMES = new Set(Object.keys(THEMES));

export interface DownloadedThemeData {
  themeName: string;
  displayName: string;
  localUri: string;
  palette: ThemePalette;
  dominantColors: DominantColor[];
  gradientColors: GradientColor[];
}

/**
 * Register a downloaded wallpaper theme into all theme engine registries.
 * Returns false if the theme name collides with a bundled theme.
 */
export function registerDownloadedTheme(data: DownloadedThemeData): boolean {
  const { themeName, displayName, localUri, palette, dominantColors, gradientColors } = data;

  // Guard: reject collisions with bundled themes
  if (BUNDLED_THEME_NAMES.has(themeName)) {
    log.warn('theme.register.collision', { themeName });
    return false;
  }

  // 1. Add palette to THEMES
  (THEMES as Record<string, ThemePalette>)[themeName] = palette;

  // 2. Pre-compute and cache theme variables
  themeVariables[themeName] = getThemeVariables(themeName);

  // 3. Add to BACKGROUND_THEME_NAMES array
  if (!BACKGROUND_THEME_NAMES.includes(themeName)) {
    BACKGROUND_THEME_NAMES.push(themeName);
  }

  // 4. Set image source (file:// URI for downloaded images)
  (backgroundImageThemes as Record<string, any>)[themeName] = { uri: localUri };

  // 5. Set display name
  (backgroundThemeDisplayNames as Record<string, string>)[themeName] = displayName;

  // 6. Set dominant colors
  (backgroundThemeDominantColors as Record<string, DominantColor[]>)[themeName] = dominantColors;

  // 7. Set gradient colors
  (backgroundThemeGradientColors as Record<string, GradientColor[]>)[themeName] = gradientColors;

  log.info('theme.register.downloaded', { themeName, displayName });
  return true;
}

/**
 * Unregister a downloaded wallpaper theme from all theme engine registries.
 */
export function unregisterDownloadedTheme(themeName: string): void {
  // Guard: never unregister bundled themes
  if (BUNDLED_THEME_NAMES.has(themeName)) return;

  delete (THEMES as Record<string, ThemePalette>)[themeName];
  delete themeVariables[themeName];

  const idx = BACKGROUND_THEME_NAMES.indexOf(themeName);
  if (idx !== -1) BACKGROUND_THEME_NAMES.splice(idx, 1);

  delete (backgroundImageThemes as Record<string, any>)[themeName];
  delete (backgroundThemeDisplayNames as Record<string, string>)[themeName];
  delete (backgroundThemeDominantColors as Record<string, DominantColor[]>)[themeName];
  delete (backgroundThemeGradientColors as Record<string, GradientColor[]>)[themeName];

  log.info('theme.unregister.downloaded', { themeName });
}
