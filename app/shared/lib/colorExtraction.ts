/**
 * Dominant-colour extraction from images.
 *
 * The colour *arithmetic* this used to carry — hex/RGB/HSL conversion,
 * luminance, blending, contrast pairs — now lives in `shared/lib/color.ts`.
 * What remains here is the part that is genuinely about images: reading a
 * palette out of one and deciding which candidate is usable.
 */

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { getColors } from 'react-native-image-colors';

import { darken, toHsl } from '@/shared/lib/color';

const FALLBACK_COLORS = [
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#14b8a6', // Teal
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#3b82f6', // Blue
  '#f43f5e', // Rose
] as const;

/** Rejects very dark, very light, or nearly desaturated colors. */
function isCornerColor(hex: string | undefined): boolean {
  if (!hex) return true;

  const { s, l } = toHsl(hex);

  if (l < 0.12 || l > 0.95) return true;
  if (s < 0.08 && l > 0.1 && l < 0.9) return true;

  return false;
}

/** Darkens overly bright or over-saturated colors for better contrast on dark UIs. */
function clampColor(hex: string): string {
  const { s, l } = toHsl(hex);

  if (l > 0.6 || s > 0.85) return darken(hex, 0.25);

  return hex;
}

function extractCandidates(res: any): (string | undefined)[] {
  if (Platform.OS === 'android') {
    return [res.vibrant, res.dominant, res.lightVibrant, res.muted, res.average];
  }

  return [res.background, res.primary, res.secondary, res.detail];
}

interface DominantColorResult {
  baseColors: string[];
  baseColor: string;
  hasLoaded: boolean;
  hasExtractedColors: boolean;
}

/**
 * Extracts dominant color from an image, filtering corner colors
 * (very dark/light/desaturated) and clamping overly bright colors.
 * Best for large images like banners and profile pictures.
 */
export function useDominantColor(
  imageUrl: string | undefined,
  fallbackIndex: number
): DominantColorResult {
  const fallback = FALLBACK_COLORS[fallbackIndex % FALLBACK_COLORS.length];
  const [baseColor, setBaseColor] = useState<string>(fallback);
  const [baseColors, setBaseColors] = useState<string[]>([fallback]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [hasExtractedColors, setHasExtractedColors] = useState(false);

  useEffect(() => {
    if (!imageUrl) {
      setHasLoaded(true);
      return;
    }

    let mounted = true;

    getColors(imageUrl, { fallback, cache: true, key: imageUrl })
      .then((res: any) => {
        if (!mounted || !res) return;

        const candidates = extractCandidates(res);
        const picked = candidates.find((c): c is string => Boolean(c) && !isCornerColor(c));

        if (picked) {
          setBaseColors(candidates.map((c) => c || fallback));
          setBaseColor(clampColor(picked));
          setHasExtractedColors(true);
        }
        setHasLoaded(true);
      })
      .catch(() => {
        setHasLoaded(true);
      });

    return () => {
      mounted = false;
    };
  }, [imageUrl, fallback]);

  return { baseColors, baseColor, hasLoaded, hasExtractedColors };
}
