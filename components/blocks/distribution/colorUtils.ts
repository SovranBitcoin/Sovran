/**
 * @fileoverview Color utility functions for distribution components
 *
 * Provides color extraction and manipulation for Spotify-style gradients.
 */

import { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import { getColors } from 'react-native-image-colors';
import { darken, lighten } from 'polished';

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

function getLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function getContrastColors(
  hex: string,
  amount: number = 0.3
): { contrastColor: string; borderColor: string } {
  const luminance = getLuminance(hex);

  if (luminance < 0.3) {
    const lightened = lighten(amount, hex);
    return { contrastColor: lightened, borderColor: lightened };
  }

  const darkened = darken(amount, hex);
  const darkenedLuminance = getLuminance(darkened);

  if (Math.abs(luminance - darkenedLuminance) < 0.1) {
    const lightened = lighten(amount, hex);
    return { contrastColor: lightened, borderColor: lightened };
  }

  return { contrastColor: darkened, borderColor: hex };
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export interface ExtractedColors {
  baseColor: string;
  gradientColors: readonly [string, string];
  borderColor: string;
  isLoading: boolean;
  hasExtractedColors: boolean;
}

export function useExtractedColors(
  imageUrl: string | undefined,
  fallbackIndex: number = 0
): ExtractedColors {
  const fallback = FALLBACK_COLORS[fallbackIndex % FALLBACK_COLORS.length];
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
          candidates = [res.vibrant, res.dominant, res.lightVibrant, res.muted, res.average];
        } else {
          candidates = [res.background, res.primary, res.secondary, res.detail];
        }

        const mainColor = candidates[1];

        if (mainColor) {
          const { contrastColor, borderColor } = getContrastColors(mainColor, 0.3);
          setColors({
            baseColor: mainColor,
            gradientColors: [mainColor, contrastColor] as const,
            borderColor,
          });
          setHasExtractedColors(true);
        } else {
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

  return { ...colors, isLoading: !hasLoaded, hasExtractedColors };
}
