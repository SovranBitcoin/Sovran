/**
 * @fileoverview Color utility functions for distribution components
 *
 * Provides color extraction and manipulation for Spotify-style gradients.
 */

import { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import { getColors } from 'react-native-image-colors';
import { darken, lighten } from 'polished';

// Fallback color palette
export const FALLBACK_COLORS = [
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#14b8a6', // Teal
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#3b82f6', // Blue
  '#f43f5e', // Rose
] as const;

/**
 * Get luminance of a hex color (0-1 scale)
 */
export function getLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Get contrasting colors for gradient and border
 * Returns { contrastColor, borderColor }
 */
export function getContrastColors(
  hex: string,
  amount: number = 0.3
): { contrastColor: string; borderColor: string } {
  const luminance = getLuminance(hex);

  // If the color is dark (luminance < 0.3), lighten instead of darken
  if (luminance < 0.3) {
    const lightened = lighten(amount, hex);
    return { contrastColor: lightened, borderColor: lightened };
  }

  // Try darkening
  const darkened = darken(amount, hex);
  const darkenedLuminance = getLuminance(darkened);

  // If darkened result is too similar (difference < 0.1), use lighten instead
  if (Math.abs(luminance - darkenedLuminance) < 0.1) {
    const lightened = lighten(amount, hex);
    return { contrastColor: lightened, borderColor: lightened };
  }

  // Normal case: darken, border stays as original color
  return { contrastColor: darkened, borderColor: hex };
}

/**
 * Parse hex to RGB
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/**
 * Convert RGB to HSL
 */
export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return { h, s, l };
}

/**
 * Check if a color is likely from the image corners (black, near-black, grays)
 */
export function isCornerColor(hex: string | undefined): boolean {
  if (!hex) return true;

  const { r, g, b } = hexToRgb(hex);
  const { s, l } = rgbToHsl(r, g, b);

  // Filter out very dark colors (likely black corners)
  if (l < 0.12) return true;
  // Filter out very light colors (nearly white)
  if (l > 0.95) return true;
  // Filter out grays (low saturation, mid lightness)
  if (s < 0.08 && l > 0.1 && l < 0.9) return true;

  return false;
}

/**
 * Clamp overly bright/saturated colors (Spotify does this)
 */
export function clampColor(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const { s, l } = rgbToHsl(r, g, b);

  // If too bright or saturated, darken more
  if (l > 0.6 || s > 0.85) {
    return darken(0.25, hex);
  }
  return hex;
}

export interface ExtractedColors {
  baseColor: string;
  gradientColors: readonly [string, string];
  borderColor: string;
  isLoading: boolean; // true = still loading, false = loaded
  hasExtractedColors: boolean; // true = colors were extracted from image, false = using fallback
}

/**
 * Hook to extract colors from an image for gradient/border styling
 * Uses the same logic as DistributionBar - picks baseColors[1] as the main color
 */
export function useExtractedColors(
  imageUrl: string | undefined,
  fallbackIndex: number = 0
): ExtractedColors {
  const fallback = FALLBACK_COLORS[fallbackIndex % FALLBACK_COLORS.length];
  // Start as loading (true) - will become false after extraction completes
  const [hasLoaded, setHasLoaded] = useState(false);
  const [hasExtractedColors, setHasExtractedColors] = useState(false);
  const [colors, setColors] = useState<Omit<ExtractedColors, 'isLoading' | 'hasExtractedColors'>>(
    () => {
      const { contrastColor, borderColor } = getContrastColors(fallback, 0.3);
      return {
        baseColor: fallback,
        gradientColors: [fallback, contrastColor] as const,
        borderColor,
      };
    }
  );

  useEffect(() => {
    if (!imageUrl) {
      // No image - use fallback immediately
      setHasLoaded(true);
      return;
    }

    let mounted = true;

    getColors(imageUrl, {
      fallback: fallback,
      cache: true,
      key: imageUrl,
    })
      .then((res: any) => {
        if (!mounted || !res) return;

        let candidates: (string | undefined)[] = [];

        if (Platform.OS === 'android') {
          // Android: same order as DistributionBar
          candidates = [res.vibrant, res.dominant, res.lightVibrant, res.muted, res.average];
        } else {
          // iOS: same order as DistributionBar
          candidates = [res.background, res.primary, res.secondary, res.detail];
        }

        // Use baseColors[1] as the main color (same as DistributionBar)
        // This is typically res.primary on iOS, res.dominant on Android
        // NOTE: Don't check isCornerColor - match DistributionBar exactly
        // DistributionBar uses: mainColor = baseColors[1] || baseColor
        const mainColor = candidates[1];

        if (mainColor) {
          // Use raw color for contrast calculation (same as DistributionBar)
          const { contrastColor, borderColor } = getContrastColors(mainColor, 0.3);
          setColors({
            baseColor: mainColor,
            gradientColors: [mainColor, contrastColor] as const,
            borderColor,
          });
          setHasExtractedColors(true);
        } else {
          // Fallback only if candidates[1] is undefined/null
          const picked = candidates.find((c) => c);
          if (picked) {
            const { contrastColor, borderColor } = getContrastColors(picked, 0.3);
            setColors({
              baseColor: picked,
              gradientColors: [picked, contrastColor] as const,
              borderColor,
            });
            setHasExtractedColors(true);
          }
          // If no colors found, hasExtractedColors stays false
        }
        setHasLoaded(true);
      })
      .catch(() => {
        // Keep fallback on error - hasExtractedColors stays false
        setHasLoaded(true);
      });

    return () => {
      mounted = false;
    };
  }, [imageUrl, fallback]);

  // isLoading = true means still loading (hasLoaded = false)
  return { ...colors, isLoading: !hasLoaded, hasExtractedColors };
}
