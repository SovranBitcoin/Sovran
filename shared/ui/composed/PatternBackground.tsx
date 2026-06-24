import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { SvgXml } from 'react-native-svg';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { log } from '@/shared/lib/logger';

const PATTERN_SOURCE_VIEWBOX = '0 0 1254 1254';
const PATTERN_OUTER_XML_RE = /^[\s\S]*?<svg\b[^>]*>([\s\S]*?)<\/svg>\s*$/i;
// The source SVG is a vector-traced raster: every path carries an explicit
// near-black `fill="#0XX..."`. Two transforms make it theme-driveable:
//
//   1. Drop the *first* `<path/>` — that's the 1254×1254 backdrop fill. If
//      left in, recolouring everything to a single theme color produces a
//      flat block instead of a pattern.
//   2. Rewrite every remaining `fill="#hex"` to `fill="currentColor"` so
//      the `color` prop on `SvgXml` flows through to every shape.
const FIRST_PATH_RE = /<path\b[^>]*\/>/i;
const FILL_HEX_RE = /\sfill="#[0-9a-fA-F]+"/g;

let cachedInnerXmlPromise: Promise<string> | null = null;

function loadPatternInnerXml(): Promise<string> {
  if (cachedInnerXmlPromise) return cachedInnerXmlPromise;
  cachedInnerXmlPromise = (async () => {
    const asset = Asset.fromModule(require('@/assets/patterns/pattern.svg'));
    await asset.downloadAsync();
    if (!asset.localUri) throw new Error('pattern.svg has no localUri after download');
    const raw = await FileSystem.readAsStringAsync(asset.localUri);
    const match = raw.match(PATTERN_OUTER_XML_RE);
    if (!match) throw new Error('pattern.svg has no parseable <svg> root');
    const stripped = match[1].replace(FIRST_PATH_RE, '');
    return stripped.replace(FILL_HEX_RE, ' fill="currentColor"');
  })().catch((err) => {
    cachedInnerXmlPromise = null;
    throw err;
  });
  return cachedInnerXmlPromise;
}

function buildWrapperXml(innerXml: string, tileSize: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><defs><pattern id="sovran-pattern-bg" patternUnits="userSpaceOnUse" x="0" y="0" width="${tileSize}" height="${tileSize}" viewBox="${PATTERN_SOURCE_VIEWBOX}">${innerXml}</pattern></defs><rect width="100%" height="100%" fill="url(#sovran-pattern-bg)"/></svg>`;
}

interface PatternBackgroundProps {
  /**
   * Pixel size of one tile of the pattern. The 1254×1254 source SVG is
   * scaled into this square and repeated across the container. Smaller
   * values = denser texture; ~240–360 reads as a fine wallpaper grain on
   * phone screens.
   * @default 280
   */
  tileSize?: number;
  /**
   * Opacity of the pattern layer. Each path in `pattern.svg` already
   * carries `fill-opacity="0.08"`, so this multiplies on top — default
   * `1` lets the per-path alpha drive the contrast unmodified.
   * @default 1
   */
  opacity?: number;
  /**
   * Stroke/fill color applied to the pattern. Defaults to the theme
   * `foreground` token so the pattern naturally contrasts against the
   * surface on both light and dark themes.
   */
  color?: string;
}

/**
 * Tileable background pattern. Loads `assets/patterns/pattern.svg`
 * once at runtime, rewrites it to be theme-colorable (see comments above
 * `FIRST_PATH_RE`), wraps it in an outer `<svg>` whose `<defs><pattern>`
 * references the rewritten artwork, and lets `react-native-svg` rasterize
 * the tile natively once before the GPU repeats it — so even though the
 * source has hundreds of paths, the cost is paid one time per mount, not
 * per repeat.
 *
 * Absolutely positioned over its parent (`StyleSheet.absoluteFillObject`)
 * and non-interactive (`pointerEvents="none"`), so the consumer just
 * mounts it as the first child of a relatively-positioned container and
 * lays its real content on top.
 *
 * Not wired through {@link BackgroundProvider} — that context drives the
 * blur transitions on the wallpaper sprite, which has a different
 * lifecycle (per-tab focus animations). The pattern layer is static, so
 * threading it through would only add bookkeeping for no payoff.
 */
function PatternBackgroundComponent({
  tileSize = 280,
  opacity = 1,
  color,
}: PatternBackgroundProps) {
  const foreground = useThemeColor('foreground');
  const [innerXml, setInnerXml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPatternInnerXml().then(
      (xml) => {
        if (!cancelled) setInnerXml(xml);
      },
      (err) => {
        log.warn('pattern.background.load_failed', { err: String(err) });
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (!innerXml) {
    return <View style={StyleSheet.absoluteFillObject} pointerEvents="none" />;
  }

  return (
    <View style={[StyleSheet.absoluteFillObject, { opacity }]} pointerEvents="none">
      <SvgXml
        xml={buildWrapperXml(innerXml, tileSize)}
        width="100%"
        height="100%"
        color={color ?? foreground}
      />
    </View>
  );
}

export const PatternBackground = React.memo(PatternBackgroundComponent);
