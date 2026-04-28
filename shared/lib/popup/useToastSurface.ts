import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { getLuminance, sanitizeColor } from '@/shared/lib/colorExtraction';

/**
 * Resolves the toast's "always-dark surface" colors against the active theme.
 *
 * Toasts read as a high-emphasis floating notification — a soft dark slab
 * with light text — in BOTH light and dark themes. The hexes carry the
 * active theme's tint so the toast feels native, but the slab is never
 * pure black or matched-to-page.
 *
 * - Light theme: bg = `default-foreground` (palette[100]) — a soft
 *   theme-tinted dark, NOT palette[0] which is a near-black and too harsh.
 * - Dark theme:  bg = `surface-tertiary` (palette[700]) — clearly lifted
 *   from the regular `background`/`surface` so the toast doesn't melt
 *   into the page.
 */
export function useToastSurface(): { bg: string; fg: string } {
  const [foreground, background, surfaceTertiary, defaultForeground] = useThemeColor([
    'foreground',
    'background',
    'surface-tertiary',
    'default-foreground',
  ] as const);
  const fgIsDark = getLuminance(sanitizeColor(String(foreground))) < 0.5;
  return fgIsDark
    ? {
        bg: sanitizeColor(String(defaultForeground)),
        fg: sanitizeColor(String(background)),
      }
    : {
        bg: sanitizeColor(String(surfaceTertiary)),
        fg: sanitizeColor(String(foreground)),
      };
}
