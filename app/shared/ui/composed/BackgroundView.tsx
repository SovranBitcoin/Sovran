import { LinearGradient } from 'expo-linear-gradient';
import { MeshGradientView } from 'expo-mesh-gradient';
import { withAlpha } from '@/shared/lib/color';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useBackgroundContext } from '@/shared/providers/BackgroundProvider';
import { ReactNode, useEffect, useSyncExternalStore } from 'react';
import { Platform, StyleSheet, useWindowDimensions, ViewStyle } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle } from 'react-native-reanimated';
import {
  carouselLayerOpacity,
  carouselX,
  getCarouselPages,
  getWallpaperOverlayTheme,
  overlayProgress,
  subscribeWallpaperLayers,
  surfaceOfTheme,
  themeLayerOpacity,
  themeSurfaceFrom,
  themeSurfaceProgress,
  themeSurfaceTo,
} from '@/shared/lib/theme/themeTransition';
import { retainWallpaperMotion } from '@/shared/lib/theme/wallpaperMotion';
import { useTheme } from '@/shared/providers/ThemeProvider';
import { isBackgroundImageTheme, getGradientColorScale } from '@/config/backgroundImageThemes';
import { View } from '@/shared/ui/primitives/View/View';
import { BlurView } from '@/shared/ui/primitives/BlurView';
import { supportsBlur } from '@/shared/lib/version';
import { Log, log, useRenderLogger } from '@/shared/lib/logger';
import AnimatedSpriteBackground from './SpriteView';

type BlurTint =
  | 'light'
  | 'dark'
  | 'default'
  | 'prominent'
  | 'systemMaterial'
  | 'systemThinMaterial'
  | 'systemUltraThinMaterial'
  | 'systemThickMaterial'
  | 'systemChromeMaterial';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  content: {
    flex: 1,
  },
});

const BACKGROUND_MESH_POINTS = [
  [0, 0],
  [0.5, 0],
  [1, 0],
  [0, 0.5],
  [0.5, 0.5],
  [1, 0.5],
  [0, 1],
  [0.5, 1],
  [1, 1],
];
const BACKGROUND_MESH_RESOLUTION = { x: 48, y: 48 };
const SCROLL_OVERLAY_MESH_COLUMNS = 3;
const SCROLL_OVERLAY_MESH_ROWS = 4;
const SCROLL_OVERLAY_MESH_RESOLUTION = { x: 24, y: 64 };

function getMeshGradientColors(
  gradientColors: Record<'100' | '200' | '300', string> | null | undefined,
  fallbackColor: string
) {
  const light = gradientColors?.['100'] || fallbackColor;
  const mid = gradientColors?.['200'] || fallbackColor;
  const dark = fallbackColor;

  return [mid, light, mid, dark, mid, light, dark, dark, mid];
}

function getScrollableOverlayMeshPoints(start: number, end: number) {
  const resolvedStart = Math.max(0, Math.min(start, 1));
  const resolvedEnd = Math.max(resolvedStart, Math.min(end, 1));

  return [0, resolvedStart, resolvedEnd, 1].flatMap((y) => [
    [0, y],
    [0.5, y],
    [1, y],
  ]);
}

function getScrollableOverlayMeshColors({
  top,
  mid,
  bottom,
}: {
  top: string;
  mid: string;
  bottom: string;
}) {
  return [top, top, top, top, top, top, mid, mid, mid, bottom, bottom, bottom];
}

// ============================================================================
// ScrollableGradientOverlay - Place inside ScrollView for scroll-synced fade
// ============================================================================

interface ScrollableGradientOverlayProps {
  /**
   * The total height of the scroll content
   * Get this from ScrollView's onContentSizeChange callback
   */
  contentHeight: number;
  /**
   * Where the fade starts (0-1, percentage of viewport height)
   * @default 0.3
   */
  blurGradientStart?: number;
  /**
   * Where the fade reaches full opacity (0-1, percentage of viewport height)
   * @default 0.6
   */
  blurGradientEnd?: number;
}

/**
 * A background-color fade that scrolls with content.
 * Place this as the FIRST child inside your ScrollView.
 *
 * @example
 * const [contentHeight, setContentHeight] = useState(0);
 *
 * <BackgroundView blurMode="partial">
 *   <ScrollView onContentSizeChange={(_, h) => setContentHeight(h)}>
 *     <ScrollableGradientOverlay contentHeight={contentHeight} />
 *     <YourActualContent />
 *   </ScrollView>
 * </BackgroundView>
 */
export function ScrollableGradientOverlay({
  contentHeight,
  blurGradientStart = 0.3,
  blurGradientEnd = 0.6,
}: ScrollableGradientOverlayProps) {
  useRenderLogger('ScrollableGradientOverlay');
  const screenBackgroundColor = useThemeColor('surface');
  const { currentTheme } = useTheme();
  const carouselPages = useSyncExternalStore(subscribeWallpaperLayers, getCarouselPages);

  // The overlay exists solely to wash the wallpaper image out under the
  // scroll content. Any carousel page with an image counts (not just the
  // active theme) so the fade doesn't pop in mid-swipe between units.
  const hasImageWallpaper =
    isBackgroundImageTheme(currentTheme) ||
    carouselPages.some((page) => isBackgroundImageTheme(page.theme));

  const viewportHeight = useWindowDimensions().height;

  // Calculate gradient locations relative to content height
  // so they always appear at the same pixel position relative to viewport
  const overlayLocations = ((): [number, number] => {
    if (contentHeight <= 0) {
      return [blurGradientStart, blurGradientEnd];
    }
    const ratio = viewportHeight / contentHeight;
    const start = Math.min(blurGradientStart * ratio, 1);
    const end = Math.min(blurGradientEnd * ratio, 1);
    return [start, end];
  })();

  const overlayHeight = contentHeight || viewportHeight;
  const androidMeshPoints = getScrollableOverlayMeshPoints(
    overlayLocations[0],
    overlayLocations[1]
  );
  const androidBackgroundMeshColors = getScrollableOverlayMeshColors({
    top: withAlpha(screenBackgroundColor, 0),
    mid: screenBackgroundColor,
    bottom: screenBackgroundColor,
  });

  // On solid-colour themes the transparent→surface alpha ramp still paints
  // (dither banding, and a foreign colour band whenever the active theme's
  // surface differs from the carousel page's) — skip it entirely.
  if (!hasImageWallpaper) {
    return null;
  }

  return (
    <Log name="ScrollableGradientOverlay">
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: overlayHeight,
        }}
        pointerEvents="none">
        {Platform.OS === 'android' ? (
          <MeshGradientView
            columns={SCROLL_OVERLAY_MESH_COLUMNS}
            rows={SCROLL_OVERLAY_MESH_ROWS}
            colors={androidBackgroundMeshColors}
            points={androidMeshPoints}
            resolution={SCROLL_OVERLAY_MESH_RESOLUTION}
            smoothsColors
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <LinearGradient
            colors={[
              withAlpha(screenBackgroundColor, 0),
              withAlpha(screenBackgroundColor, 0),
              screenBackgroundColor,
              screenBackgroundColor,
            ]}
            locations={[0, overlayLocations[0], overlayLocations[1], 1]}
            dither
            style={StyleSheet.absoluteFill}
          />
        )}
      </View>
    </Log>
  );
}

// ============================================================================
// AnimatedBackgroundView - Layout-level background with animated blur transitions
// ============================================================================

interface AnimatedBackgroundViewProps {
  children?: ReactNode;
  /**
   * Blur tint style
   * @default 'dark'
   */
  blurTint?: BlurTint;
  /**
   * Additional style for the container
   */
  style?: ViewStyle;
  /**
   * Opacity for the gradient overlay at the top edge (0-1).
   * @default 0 (transparent at top, matching the default behaviour)
   */
  gradientTopOpacity?: number;
  /**
   * Override the gradient overlay color. Defaults to the theme surface color.
   */
  gradientColor?: string;
  /**
   * Render the theme gradient as a native mesh. Useful for Android
   * surfaces where linear gradients show banding.
   * @default false
   */
  useMeshGradient?: boolean;
}

/**
 * An animated background component for use at the layout level.
 * Uses BackgroundContext shared values to animate blur transitions
 * when switching between tabs.
 *
 * Must be used within a BackgroundProvider.
 *
 * @example
 * <BackgroundProvider>
 *   <AnimatedBackgroundView>
 *     <NativeTabs>...</NativeTabs>
 *   </AnimatedBackgroundView>
 * </BackgroundProvider>
 */
export function AnimatedBackgroundView({
  children,
  blurTint = 'dark',
  style,
  gradientTopOpacity = 0,
  gradientColor,
  useMeshGradient = false,
}: AnimatedBackgroundViewProps) {
  useRenderLogger('AnimatedBackgroundView');
  const surface = useThemeColor('surface');
  const { currentTheme } = useTheme();

  log.debug('bg.view.render', {
    theme: currentTheme,
    isImageTheme: isBackgroundImageTheme(currentTheme),
    blurTint,
  });

  const { fullBlurOpacity, backgroundOpacity, backgroundColor } = useBackgroundContext();

  // Check if blur is supported on this device
  const blurSupported = supportsBlur();

  const fullBlurAnimatedStyle = useAnimatedStyle(() => ({
    opacity: fullBlurOpacity.value,
  }));

  // The wallpaper stack: one PERSISTENT layer per account-carousel page
  // (registered by the pager) plus at most one programmatic overlay layer.
  // Layer opacities derive from carouselX / overlayProgress in worklets, so
  // drags and transitions touch zero React state.
  const carouselPages = useSyncExternalStore(subscribeWallpaperLayers, getCarouselPages);
  const overlayTheme = useSyncExternalStore(subscribeWallpaperLayers, getWallpaperOverlayTheme);

  // ONE shared DeviceMotion subscription drives every layer's parallax
  // transform (they all read the shared wallpaperMotion value), retained
  // here while any image wallpaper is in play.
  const hasImageWallpaper =
    isBackgroundImageTheme(currentTheme) ||
    carouselPages.some((page) => isBackgroundImageTheme(page.theme));
  useEffect(() => {
    if (!hasImageWallpaper) return;
    return retainWallpaperMotion();
  }, [hasImageWallpaper]);

  const backgroundAnimatedStyle = useAnimatedStyle(() => ({
    // themeLayerOpacity dips to 0 during color-only theme switches so the
    // wallpaper swaps at the fade's midpoint.
    opacity: backgroundOpacity.value * themeLayerOpacity.value,
  }));

  // Color-theme glide: while a color-only theme transition runs, an overlay
  // above the base color interpolates old-surface → new-surface, so those
  // themes glide instead of snapping when the CSS vars swap at the dip. It
  // hides itself (opacity 0) once the glide completes. Image transitions
  // don't need it — every wallpaper layer carries its own opaque surface.
  const surfaceGlideStyle = useAnimatedStyle(() => {
    const from = themeSurfaceFrom.value;
    const to = themeSurfaceTo.value;
    if (!from || !to || themeSurfaceProgress.value >= 1) {
      return { opacity: 0, backgroundColor: 'transparent' };
    }
    return {
      opacity: 1,
      backgroundColor: interpolateColor(themeSurfaceProgress.value, [0, 1], [from, to]),
    };
  });

  const backgroundColorAnimatedStyle = useAnimatedStyle(() => ({
    backgroundColor: backgroundColor.value || surface,
  }));

  return (
    <Log name="AnimatedBackgroundView">
      <View style={[styles.container, style]}>
        {/* Base background color */}
        <Animated.View style={[StyleSheet.absoluteFill, backgroundColorAnimatedStyle]} />

        {/* Theme-transition surface glide (invisible outside transitions) */}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, surfaceGlideStyle]} />

        {/* The wallpaper stack. Page layers stack in page order (page 0
            bottom … page N top) so a drag is always a top-layer-only fade;
            the programmatic overlay sits above them all. The stack falls
            back to a single static layer for the current theme until the
            pager registers its pages. */}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, backgroundAnimatedStyle]}>
          {carouselPages.length > 0 ? (
            carouselPages.map((page, index) => (
              <WallpaperLayer
                key={page.unit}
                theme={page.theme}
                pageIndex={index}
                pageCount={carouselPages.length}
                fallbackSurface={surface}
                gradientColor={gradientColor}
                gradientTopOpacity={gradientTopOpacity}
                showImage
                useMeshGradient={useMeshGradient}
              />
            ))
          ) : (
            <WallpaperLayer
              theme={currentTheme}
              fallbackSurface={surface}
              gradientColor={gradientColor}
              gradientTopOpacity={gradientTopOpacity}
              showImage
              useMeshGradient={useMeshGradient}
            />
          )}
          {overlayTheme && (
            <WallpaperLayer
              theme={overlayTheme}
              overlay
              fallbackSurface={surface}
              gradientColor={gradientColor}
              gradientTopOpacity={gradientTopOpacity}
              showImage
              useMeshGradient={useMeshGradient}
            />
          )}
        </Animated.View>

        {blurSupported && (
          <Animated.View
            style={[StyleSheet.absoluteFill, fullBlurAnimatedStyle]}
            pointerEvents="none">
            <BlurView intensity={200} tint={blurTint} style={StyleSheet.absoluteFill} />
          </Animated.View>
        )}

        <View style={[styles.content]}>{children}</View>
      </View>
    </Log>
  );
}

/**
 * One persistent wallpaper layer. Each layer carries its OWN theme's opaque
 * surface color (solid underlay + gradient tint), so crossfades never bleed
 * the backdrop through and nothing recolors when the CSS vars swap. Hidden
 * layers cost decoded-bitmap memory only: opacity 0, pointerEvents none,
 * parallax motion subscription shared (retained once by the parent), and
 * expo-image decodes capped at view size.
 *
 * Visibility is worklet-only — a pure function of `carouselX` for page
 * layers (see carouselLayerOpacity) or `overlayProgress` for the overlay —
 * so drags raise layers with zero React re-renders.
 */
function WallpaperLayer({
  theme,
  pageIndex,
  pageCount,
  overlay = false,
  fallbackSurface,
  gradientColor,
  gradientTopOpacity,
  showImage,
  useMeshGradient,
}: {
  theme: string;
  /** Carousel page this layer belongs to; omit (with pageCount) for the
   *  static fallback layer, which holds opacity 1. */
  pageIndex?: number;
  pageCount?: number;
  /** The programmatic-transition overlay layer (tracks overlayProgress). */
  overlay?: boolean;
  fallbackSurface: string;
  gradientColor?: string;
  gradientTopOpacity: number;
  showImage: boolean;
  useMeshGradient: boolean;
}) {
  const layerSurface = surfaceOfTheme(theme) ?? fallbackSurface;
  const isPage = pageIndex !== undefined && pageCount !== undefined;
  const layerStyle = useAnimatedStyle(() => ({
    opacity: overlay
      ? overlayProgress.value
      : isPage
        ? carouselLayerOpacity(carouselX.value, pageIndex as number, pageCount as number)
        : 1,
  }));
  const meshColors = getMeshGradientColors(
    isBackgroundImageTheme(theme) ? getGradientColorScale(theme) : null,
    gradientColor || layerSurface
  );
  // Without an image (and with no explicit tint colour) the transparent→
  // surface ramp composites to a flat surface fill — but `dither` still adds
  // visible noise to it. Paint the flat fill directly instead.
  const isFlatFill = !isBackgroundImageTheme(theme) && !gradientColor;
  const flatFillStyle = [StyleSheet.absoluteFill, { backgroundColor: layerSurface }];
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, layerStyle]}>
      {showImage && (
        <AnimatedSpriteBackground
          themeName={theme}
          backgroundColor={layerSurface}
          motionEnabled={false}
          imageTransitionMs={0}
        />
      )}
      {isFlatFill ? (
        <View style={flatFillStyle} pointerEvents="none" />
      ) : useMeshGradient ? (
        <MeshGradientView
          columns={3}
          rows={3}
          colors={meshColors}
          points={BACKGROUND_MESH_POINTS}
          resolution={BACKGROUND_MESH_RESOLUTION}
          smoothsColors
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <LinearGradient
          colors={[
            withAlpha(gradientColor || layerSurface, gradientTopOpacity),
            gradientColor || layerSurface,
          ]}
          locations={[0, 1]}
          dither
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}
    </Animated.View>
  );
}
