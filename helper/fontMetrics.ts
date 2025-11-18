/**
 * Font metrics for Capsize vertical trimming
 * These metrics are extracted from the font files themselves
 * and are used to calculate precise text sizing by cap height.
 */

export interface FontMetrics {
  capHeight: number;
  ascent: number;
  descent: number;
  lineGap: number;
  unitsPerEm: number;
}

/**
 * Overpass Regular font metrics
 * These metrics are used for all Overpass font weights initially.
 * Individual weight metrics can be added later if needed for more precision.
 */
export const overpassMetrics: FontMetrics = {
  capHeight: 1456,
  ascent: 2100,
  descent: -500,
  lineGap: 0,
  unitsPerEm: 2048,
};

/**
 * Get font metrics for a given font family and weight
 * Currently returns Overpass Regular metrics for all Overpass variants.
 * Can be extended to return specific metrics for different weights/variants.
 */
export function getFontMetrics(
  family: 'overpass' | 'lexend',
  _weight?: string,
  _italic?: boolean
): FontMetrics | null {
  // Only Overpass is supported for now
  if (family === 'overpass') {
    return overpassMetrics;
  }

  // Lexend metrics can be added here later
  return null;
}
