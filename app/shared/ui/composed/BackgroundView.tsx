import { LinearGradient } from 'expo-linear-gradient';
import { MeshGradientView } from 'expo-mesh-gradient';
import opacity from 'hex-color-opacity';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useBackgroundContext } from '@/shared/providers/BackgroundProvider';
import React, { memo, ReactNode, useMemo, useSyncExternalStore } from 'react';
import { Platform, StyleSheet, useWindowDimensions, ViewStyle } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle } from 'react-native-reanimated';
import {
  getThemeDragTarget,
  subscribeThemeDragTarget,
  themeDragProgress,
  themeDragTargetSv,
  themeLayerOpacity,
  themeSurfaceFrom,
  themeSurfaceProgress,
  themeSurfaceTo,
} from '@/shared/lib/theme/themeTransition';
import { useTheme } from '@/shared/providers/ThemeProvider';
import { useThemeStore } from '@/shared/stores/profile/themeStore';
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
function ScrollableGradientOverlayComponent({
  contentHeight,
  blurGradientStart = 0.3,
  blurGradientEnd = 0.6,
}: ScrollableGradientOverlayProps) {
  useRenderLogger('ScrollableGradientOverlay');
  const screenBackgroundColor = useThemeColor('surface');

  const viewportHeight = useWindowDimensions().height;

  // Calculate gradient locations relative to content height
  // so they always appear at the same pixel position relative to viewport
  const overlayLocations = useMemo((): [number, number] => {
    if (contentHeight <= 0) {
      return [blurGradientStart, blurGradientEnd];
    }
    const ratio = viewportHeight / contentHeight;
    const start = Math.min(blurGradientStart * ratio, 1);
    const end = Math.min(blurGradientEnd * ratio, 1);
    return [start, end];
  }, [viewportHeight, contentHeight, blurGradientStart, blurGradientEnd]);

  const overlayHeight = contentHeight || viewportHeight;
  const androidMeshPoints = useMemo(
    () => getScrollableOverlayMeshPoints(overlayLocations[0], overlayLocations[1]),
    [overlayLocations]
  );
  const androidBackgroundMeshColors = useMemo(
    () =>
      getScrollableOverlayMeshColors({
        top: opacity(screenBackgroundColor, 0),
        mid: screenBackgroundColor,
        bottom: screenBackgroundColor,
      }),
    [screenBackgroundColor]
  );
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
              opacity(screenBackgroundColor, 0),
              opacity(screenBackgroundColor, 0),
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

export const ScrollableGradientOverlay = memo(ScrollableGradientOverlayComponent);

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
   * Render the active wallpaper image behind the gradient overlay.
   * @default true
   */
  showBackgroundImage?: boolean;
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
function AnimatedBackgroundViewComponent({
  children,
  blurTint = 'dark',
  style,
  gradientTopOpacity = 0,
  gradientColor,
  showBackgroundImage = true,
  useMeshGradient = false,
}: AnimatedBackgroundViewProps) {
  useRenderLogger('AnimatedBackgroundView');
  const surface = useThemeColor('surface');

  // Get gradient colors for background image themes
  const { currentTheme } = useTheme();
  const gradientColors = useMemo(() => {
    if (isBackgroundImageTheme(currentTheme)) {
      return getGradientColorScale(currentTheme);
    }
    return null;
  }, [currentTheme]);
  const meshGradientColors = useMemo(
    () => getMeshGradientColors(gradientColors, gradientColor || surface),
    [gradientColors, gradientColor, surface]
  );

  log.debug('bg.view.render', {
    theme: currentTheme,
    isImageTheme: !!gradientColors,
    blurTint,
  });

  const { fullBlurOpacity, backgroundOpacity, backgroundColor } = useBackgroundContext();

  // Check if blur is supported on this device
  const blurSupported = supportsBlur();

  const fullBlurAnimatedStyle = useAnimatedStyle(() => ({
    opacity: fullBlurOpacity.value,
  }));

  // Drag-driven crossfade: every unit-assigned wallpaper stays PRE-MOUNTED
  // (decoded, opacity 0, parallax off) so the adjacent account's image is on
  // the GPU before a drag even starts; the drag just raises its layer's
  // opacity. Distinct themes only — a couple of full-screen bitmaps, decode
  // capped at view size.
  const dragTargetTheme = useSyncExternalStore(subscribeThemeDragTarget, getThemeDragTarget);
  const unitWallpapers = useThemeStore((s) => s.unitWallpapers);
  const preloadedThemes = useMemo(() => {
    const themes = new Set<string>(Object.values(unitWallpapers));
    if (dragTargetTheme) themes.add(dragTargetTheme);
    themes.delete(currentTheme);
    return [...themes];
  }, [unitWallpapers, dragTargetTheme, currentTheme]);

  const backgroundAnimatedStyle = useAnimatedStyle(() => ({
    // themeLayerOpacity dips to 0 during (non-drag) theme switches so the
    // wallpaper swaps at the fade's midpoint; themeDragProgress crossfades
    // toward the drag target while the carousel moves.
    opacity: backgroundOpacity.value * themeLayerOpacity.value * (1 - themeDragProgress.value),
  }));

  // Color-theme glide: while a theme transition runs, an overlay above the
  // base color interpolates old-surface → new-surface, so color-only themes
  // transition instead of snapping when the CSS vars swap at the dip. It
  // hides itself (opacity 0) once the glide completes.
  const surfaceGlideStyle = useAnimatedStyle(() => {
    const from = themeSurfaceFrom.value;
    const to = themeSurfaceTo.value;
    // Drag progress takes precedence: it maps the carousel position directly.
    const progress =
      themeDragProgress.value > 0 ? themeDragProgress.value : themeSurfaceProgress.value;
    const active = themeDragProgress.value > 0 || themeSurfaceProgress.value < 1;
    if (!from || !to || !active) {
      return { opacity: 0, backgroundColor: 'transparent' };
    }
    return {
      opacity: 1,
      backgroundColor: interpolateColor(progress, [0, 1], [from, to]),
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

        {/* Animated background image plus optional theme fade */}
        <Animated.View style={[StyleSheet.absoluteFill, backgroundAnimatedStyle]}>
          {showBackgroundImage && (
            <AnimatedSpriteBackground backgroundColor={surface} imageTransitionMs={0} />
          )}

          {useMeshGradient ? (
            <MeshGradientView
              columns={3}
              rows={3}
              colors={meshGradientColors}
              points={BACKGROUND_MESH_POINTS}
              resolution={BACKGROUND_MESH_RESOLUTION}
              smoothsColors
              style={StyleSheet.absoluteFill}
            />
          ) : (
            /* Gradient overlay for image themes */
            (gradientColors || gradientColor) && (
              <LinearGradient
                colors={[
                  opacity(gradientColor || surface, gradientTopOpacity),
                  gradientColor || surface,
                ]}
                locations={[0, 1]}
                dither
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
            )
          )}
        </Animated.View>

        {/* Pre-mounted wallpaper layers (one per unit-assigned theme):
            decoded and composited at opacity 0 until one becomes the drag
            target, whose opacity then tracks the drag fraction. */}
        {showBackgroundImage &&
          preloadedThemes.map((theme) => (
            <PreloadedWallpaperLayer
              key={theme}
              theme={theme}
              surface={surface}
              gradientColor={gradientColor}
              gradientTopOpacity={gradientTopOpacity}
            />
          ))}

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

export const AnimatedBackgroundView = memo(AnimatedBackgroundViewComponent);

/**
 * One pre-mounted wallpaper layer for the account carousel. Hidden layers
 * cost decoded-bitmap memory only: opacity 0, pointerEvents none, parallax
 * motion disabled (each enabled SpriteView streams DeviceMotion at 50ms),
 * and expo-image decodes capped at view size. The drag target's opacity
 * tracks the drag fraction directly.
 */
const PreloadedWallpaperLayer = memo(function PreloadedWallpaperLayer({
  theme,
  surface,
  gradientColor,
  gradientTopOpacity,
}: {
  theme: string;
  surface: string;
  gradientColor?: string;
  gradientTopOpacity: number;
}) {
  // Worklet-only visibility: comparing against the drag-target SHARED VALUE
  // means dragging raises this layer with zero React re-renders.
  const layerStyle = useAnimatedStyle(() => ({
    opacity: themeDragTargetSv.value === theme ? themeDragProgress.value : 0,
  }));
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, layerStyle]}>
      <AnimatedSpriteBackground
        themeName={theme}
        backgroundColor={surface}
        motionEnabled={false}
        imageTransitionMs={0}
      />
      <LinearGradient
        colors={[opacity(gradientColor || surface, gradientTopOpacity), gradientColor || surface]}
        locations={[0, 1]}
        dither
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
    </Animated.View>
  );
});
