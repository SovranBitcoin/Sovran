/**
 * @fileoverview Distribution Bar Component
 *
 * A stacked horizontal bar showing the percentage allocation
 * of each mint as colored segments. Shows mint avatars for
 * segments with enough space (>= 12%).
 *
 * Uses Spotify-style color extraction:
 * 1. Extract dominant color from mint icon
 * 2. Create gradient: dominant (darkened) → fade → near-black
 */

import React, { useMemo, useEffect, useState } from 'react';
import { StyleSheet, View, LayoutChangeEvent, Platform } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { getColors } from 'react-native-image-colors';
import { Avatar } from 'components/ui/Avatar';
import { TOTAL_BASIS_POINTS } from 'stores/mintDistributionStore';
import { darken, lighten } from 'polished';
import { useThemeColor } from 'hooks/useThemeColor';

// Bar configuration
const BAR_HEIGHT = 32;
const MIN_PERCENTAGE_FOR_AVATAR = 12;
const AVATAR_SIZE = 20;
const GAP_WIDTH = 2;

// Spring config for smooth animations
const SPRING_CONFIG = {
  damping: 20,
  stiffness: 200,
  mass: 0.5,
};

// Fallback color palette
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

/**
 * Get luminance of a hex color (0-1 scale)
 */
function getLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Get contrasting colors for gradient and border
 * Returns { contrastColor, borderColor, didLighten }
 */
function getContrastColors(
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
function hexToRgb(hex: string): { r: number; g: number; b: number } {
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

/**
 * Check if a color is likely from the image corners (black, near-black, grays)
 */
function isCornerColor(hex: string | undefined): boolean {
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
function clampColor(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const { s, l } = rgbToHsl(r, g, b);

  // If too bright or saturated, darken more
  if (l > 0.6 || s > 0.85) {
    return darken(0.25, hex);
  }
  return hex;
}

// ============================================
// COLOR EXTRACTION HOOK (Spotify-style)
// ============================================

/**
 * Hook to extract dominant color from an image (Spotify-style)
 * Returns the base color for gradient creation
 */
function useDominantColor(
  imageUrl: string | undefined,
  fallbackIndex: number
): { baseColors: string[]; baseColor: string; hasLoaded: boolean } {
  const fallback = FALLBACK_COLORS[fallbackIndex % FALLBACK_COLORS.length];
  const [baseColor, setBaseColor] = useState<string>(fallback);
  const [baseColors, setBaseColors] = useState<string[]>([fallback]);
  // Start as NOT loaded - will become true after extraction completes
  const [hasLoaded, setHasLoaded] = useState(false);

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

        let picked: string | undefined;
        let candidates: string[] = [];

        if (Platform.OS === 'android') {
          // Android: prefer vibrant, then dominant, then average
          candidates = [res.vibrant, res.dominant, res.lightVibrant, res.muted, res.average];
          picked = candidates.find((c: string | undefined) => c && !isCornerColor(c));
        } else {
          // iOS: prefer primary, then secondary, then background
          candidates = [res.background, res.primary, res.secondary, res.detail];
          picked = candidates.find((c: string | undefined) => c && !isCornerColor(c));
        }

        if (picked) {
          setBaseColors(candidates);
          setBaseColor(clampColor(picked));
        }
        setHasLoaded(true);
      })
      .catch(() => {
        // Keep fallback on error
        setHasLoaded(true);
      });

    return () => {
      mounted = false;
    };
  }, [imageUrl, fallback]);

  return { baseColors, baseColor, hasLoaded };
}

// ============================================
// COMPONENTS
// ============================================

// Inner shadow constants (same as DistributionSlider)
const INNER_SHADOW_TOP = ['rgba(0,0,0,0.25)', 'rgba(0,0,0,0.08)', 'transparent'] as const;
const INNER_HIGHLIGHT_BOTTOM = ['transparent', 'rgba(0,0,0,0.03)', 'rgba(0,0,0,0.08)'] as const;

interface SegmentProps {
  mintInfo: any;
  bp: number;
  totalWidth: number;
  colorIndex: number;
  isFirst: boolean;
  activeCount: number;
}

const AnimatedSegment: React.FC<SegmentProps> = ({
  mintInfo,
  bp,
  totalWidth,
  colorIndex,
  isFirst,
  activeCount,
}) => {
  const [defaultColor, surfaceTertiary] = useThemeColor(['default', 'surface-tertiary'] as const);
  const mintName = mintInfo?.name || 'Mint';
  const mintIcon = mintInfo?.icon_url;

  const primaryColor600 = defaultColor;
  const primaryColor700 = surfaceTertiary;

  // Extract dominant color (Spotify-style)
  const { baseColors, baseColor, hasLoaded } = useDominantColor(mintIcon, colorIndex);

  // Create gradient and border colors using extracted colors
  // Uses baseColors[1] as the main color, with smart contrast adjustment
  const { gradientColors, borderColor } = useMemo(() => {
    if (!hasLoaded) {
      // Skeleton: theme-based gradient while loading
      return {
        gradientColors: [primaryColor600, primaryColor700] as const,
        borderColor: primaryColor700,
      };
    }
    // Check if we have valid extracted colors
    const mainColor = baseColors[1] || baseColor;
    // If mainColor is a fallback color, use theme colors instead
    if (FALLBACK_COLORS.includes(mainColor as any)) {
      return {
        gradientColors: [primaryColor600, primaryColor700] as const,
        borderColor: primaryColor700,
      };
    }
    const { contrastColor, borderColor: border } = getContrastColors(mainColor, 0.3);
    return {
      gradientColors: [mainColor, contrastColor] as const,
      borderColor: border,
    };
  }, [hasLoaded, baseColors, baseColor, primaryColor600, primaryColor700]);

  // Calculate target width based on bp
  const gapSpace = (activeCount - 1) * GAP_WIDTH;
  const availableWidth = totalWidth - gapSpace;
  const targetWidth = (bp / TOTAL_BASIS_POINTS) * availableWidth;
  const percentage = (bp / TOTAL_BASIS_POINTS) * 100;
  const showAvatar = percentage >= MIN_PERCENTAGE_FOR_AVATAR;

  // Animated width
  const animatedWidth = useSharedValue(targetWidth);

  useEffect(() => {
    animatedWidth.value = withSpring(targetWidth, SPRING_CONFIG);
  }, [targetWidth, animatedWidth]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: animatedWidth.value,
    marginLeft: isFirst ? 0 : GAP_WIDTH,
  }));

  if (bp === 0) return null;

  return (
    <Animated.View
      style={[
        styles.segment,
        animatedStyle,
        {
          borderWidth: 1,
          borderColor: borderColor,
        },
      ]}>
      {/* Gradient using extracted colors */}
      <LinearGradient
        colors={gradientColors}
        locations={[0, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.segmentGradient}>
        {/* Inner shadow - top inset (shadcn style) */}
        <LinearGradient
          colors={INNER_SHADOW_TOP}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.innerShadowTop}
        />
        {/* Bottom highlight for subtle lift */}
        <LinearGradient
          colors={INNER_HIGHLIGHT_BOTTOM}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.innerHighlightBottom}
        />
        {/* Avatar */}
        {showAvatar && (
          <View style={styles.avatarContainer}>
            <Avatar
              picture={mintIcon}
              size={AVATAR_SIZE}
              variant="mint"
              name={mintName}
              alt={`${mintName} icon`}
            />
          </View>
        )}
      </LinearGradient>
    </Animated.View>
  );
};

interface DistributionBarProps {
  distribution: Record<string, number>;
  mintInfoMap: Record<string, any>;
  mintUrls: string[];
}

export const DistributionBar: React.FC<DistributionBarProps> = ({
  distribution,
  mintInfoMap,
  mintUrls,
}) => {
  const [containerWidth, setContainerWidth] = useState(0);

  const handleLayout = (event: LayoutChangeEvent) => {
    setContainerWidth(event.nativeEvent.layout.width);
  };

  const activeCount = useMemo(() => {
    return mintUrls.filter((url) => (distribution[url] || 0) > 0).length;
  }, [distribution, mintUrls]);

  const isEmpty = activeCount === 0;

  return (
    <View style={styles.container} onLayout={handleLayout}>
      {containerWidth > 0 && !isEmpty && (
        <View style={styles.segmentsRow}>
          {mintUrls.map((mintUrl, index) => {
            const bp = distribution[mintUrl] || 0;
            if (bp === 0) return null;

            const activeIndexBeforeThis = mintUrls
              .slice(0, index)
              .filter((url) => (distribution[url] || 0) > 0).length;

            return (
              <AnimatedSegment
                key={mintUrl}
                mintInfo={mintInfoMap[mintUrl]}
                bp={bp}
                totalWidth={containerWidth}
                colorIndex={index}
                isFirst={activeIndexBeforeThis === 0}
                activeCount={activeCount}
              />
            );
          })}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: BAR_HEIGHT,
    overflow: 'visible',
    marginHorizontal: 16,
    marginBottom: 8,
  },
  segmentsRow: {
    flex: 1,
    flexDirection: 'row',
  },
  segment: {
    height: '100%',
    borderRadius: 12,
    overflow: 'hidden',
  },
  segmentGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  innerShadowTop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: '50%',
  },
  innerHighlightBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '50%',
  },
  avatarContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
