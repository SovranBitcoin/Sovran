/**
 * @fileoverview Shared color extraction and manipulation utilities.
 *
 * Pure functions for hex/RGB/HSL conversion, contrast/luminance, and
 * two React hooks for extracting dominant colors from images:
 * - useExtractedColors: returns gradient pair + border from the primary palette color
 * - useDominantColor: filters corner colors and clamps brightness; better for banners/large images
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

// ---------------------------------------------------------------------------
// Color conversion
// ---------------------------------------------------------------------------

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** Strip spurious "px" units that Uniwind sometimes injects into color values. */
export function sanitizeColor(value: string): string {
  return value.replace(/px/g, '');
}

/** Parse hex or rgba string to RGB. Returns null if unparseable. */
function parseColorToRgb(color: string): { r: number; g: number; b: number } | null {
  const cleaned = sanitizeColor(color);
  if (cleaned.startsWith('#')) {
    return hexToRgb(cleaned);
  }
  const rgba = cleaned.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgba) {
    return {
      r: parseInt(rgba[1]!, 10),
      g: parseInt(rgba[2]!, 10),
      b: parseInt(rgba[3]!, 10),
    };
  }
  return null;
}

/** Blend two colors. amount 0 = base, 1 = accent. Returns opaque hex. */
export function blendColors(base: string, accent: string, amount: number): string {
  const a = parseColorToRgb(base);
  const b = parseColorToRgb(accent);
  if (!a || !b) return base.startsWith('#') ? base : '#1a1a1a';
  const r = Math.round(a.r * (1 - amount) + b.r * amount);
  const g = Math.round(a.g * (1 - amount) + b.g * amount);
  const bVal = Math.round(a.b * (1 - amount) + b.b * amount);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bVal.toString(16).padStart(2, '0')}`;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
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

/** Perceived luminance (0-1) using ITU-R BT.601 weights. */
export function getLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.299 * (r / 255) + 0.587 * (g / 255) + 0.114 * (b / 255);
}

function getHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsl(r, g, b);
}

// ---------------------------------------------------------------------------
// Contrast / filtering
// ---------------------------------------------------------------------------

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

/** Rejects very dark, very light, or nearly desaturated colors. */
function isCornerColor(hex: string | undefined): boolean {
  if (!hex) return true;
  const { s, l } = getHsl(hex);
  if (l < 0.12 || l > 0.95) return true;
  if (s < 0.08 && l > 0.1 && l < 0.9) return true;
  return false;
}

/** Darkens overly bright or over-saturated colors for better contrast on dark UIs. */
function clampColor(hex: string): string {
  const { s, l } = getHsl(hex);
  if (l > 0.6 || s > 0.85) return darken(0.25, hex);
  return hex;
}

// ---------------------------------------------------------------------------
// Platform-aware candidate extraction (shared by both hooks)
// ---------------------------------------------------------------------------

function extractCandidates(res: any): (string | undefined)[] {
  if (Platform.OS === 'android') {
    return [res.vibrant, res.dominant, res.lightVibrant, res.muted, res.average];
  }
  return [res.background, res.primary, res.secondary, res.detail];
}

// ---------------------------------------------------------------------------
// useExtractedColors
// ---------------------------------------------------------------------------

export interface ExtractedColors {
  baseColor: string;
  gradientColors: readonly [string, string];
  borderColor: string;
  isLoading: boolean;
  hasExtractedColors: boolean;
}

/**
 * Extracts a gradient color pair from the image's primary palette color.
 * Best for small images like mint icons.
 */
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

    getColors(imageUrl, { fallback, cache: true, key: imageUrl })
      .then((res: any) => {
        if (!mounted || !res) return;

        const candidates = extractCandidates(res);
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

// ---------------------------------------------------------------------------
// useDominantColor
// ---------------------------------------------------------------------------

export interface DominantColorResult {
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
