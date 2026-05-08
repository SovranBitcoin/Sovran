import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { MeshGradientView } from 'expo-mesh-gradient';
import opacity from 'hex-color-opacity';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useBackgroundContext } from '@/shared/providers/BackgroundProvider';
import React, { memo, ReactNode, useMemo } from 'react';
import { Platform, StyleSheet, useWindowDimensions, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
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
  const dark = gradientColors?.['300'] || fallbackColor;

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
// ScrollableGradientOverlay - Place inside ScrollView for scroll-synced blur
// ============================================================================

interface ScrollableGradientOverlayProps {
  /**
   * The total height of the scroll content
   * Get this from ScrollView's onContentSizeChange callback
   */
  contentHeight: number;
  /**
   * Blur intensity (0-100)
   * @default 200
   */
  blurIntensity?: number;
  /**
   * Blur tint style
   * @default 'dark'
   */
  blurTint?: BlurTint;
  /**
   * Where the blur starts (0-1, percentage of viewport height)
   * @default 0.3
   */
  blurGradientStart?: number;
  /**
   * Where the blur reaches full opacity (0-1, percentage of viewport height)
   * @default 0.6
   */
  blurGradientEnd?: number;
  /**
   * Show the theme-based gradient color overlay
   * @default true
   */
  showGradientOverlay?: boolean;
  /**
   * Opacity of the gradient overlay (0-1)
   * @default 0.33
   */
  gradientOverlayOpacity?: number;
}

/**
 * A gradient/blur overlay that scrolls with content.
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
  blurIntensity = 200,
  blurTint = 'dark',
  blurGradientStart = 0.3,
  blurGradientEnd = 0.6,
  showGradientOverlay = true,
  gradientOverlayOpacity = 0.33,
}: ScrollableGradientOverlayProps) {
  useRenderLogger('ScrollableGradientOverlay');
  const background = useThemeColor('background');
  const primaryColor950 = useMemo(() => background, [background]);

  const viewportHeight = useWindowDimensions().height;

  // Get gradient colors for background image themes
  const { currentTheme } = useTheme();
  const gradientColors = useMemo(() => {
    if (isBackgroundImageTheme(currentTheme)) {
      return getGradientColorScale(currentTheme);
    }
    return null;
  }, [currentTheme]);

  // Calculate gradient locations relative to content height
  // so they always appear at the same pixel position relative to viewport
  const gradientLocations = useMemo((): {
    maskLocations: [number, number, number, number];
    overlayLocations: [number, number];
  } => {
    if (contentHeight <= 0) {
      return {
        maskLocations: [0, blurGradientStart, blurGradientEnd, 1],
        overlayLocations: [blurGradientStart, blurGradientEnd],
      };
    }
    const ratio = viewportHeight / contentHeight;
    const start = Math.min(blurGradientStart * ratio, 1);
    const end = Math.min(blurGradientEnd * ratio, 1);
    return {
      maskLocations: [0, start, end, 1],
      overlayLocations: [start, end],
    };
  }, [viewportHeight, contentHeight, blurGradientStart, blurGradientEnd]);

  const overlayHeight = contentHeight || viewportHeight;
  const androidMeshPoints = useMemo(
    () =>
      getScrollableOverlayMeshPoints(
        gradientLocations.overlayLocations[0],
        gradientLocations.overlayLocations[1]
      ),
    [gradientLocations.overlayLocations]
  );
  const androidThemeMeshColors = useMemo(() => {
    if (!gradientColors) return null;

    const color = gradientColors['300'];
    return getScrollableOverlayMeshColors({
      top: opacity(color, 0),
      mid: opacity(color, gradientOverlayOpacity),
      bottom: opacity(color, gradientOverlayOpacity),
    });
  }, [gradientColors, gradientOverlayOpacity]);
  const androidBackgroundMeshColors = useMemo(
    () =>
      getScrollableOverlayMeshColors({
        top: opacity(primaryColor950, 0),
        mid: opacity(primaryColor950, gradientOverlayOpacity),
        bottom: primaryColor950,
      }),
    [primaryColor950, gradientOverlayOpacity]
  );
  const androidMaskMeshColors = useMemo(
    () =>
      getScrollableOverlayMeshColors({
        top: 'transparent',
        mid: primaryColor950,
        bottom: primaryColor950,
      }),
    []
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
            colors={androidMaskMeshColors}
            points={androidMeshPoints}
            resolution={SCROLL_OVERLAY_MESH_RESOLUTION}
            smoothsColors
            style={StyleSheet.absoluteFillObject}
          />
        ) : (
          <MaskedView
            style={StyleSheet.absoluteFillObject}
            maskElement={
              <LinearGradient
                colors={['transparent', 'transparent', 'black', 'black']}
                locations={gradientLocations.maskLocations}
                style={StyleSheet.absoluteFillObject}
              />
            }>
            <BlurView
              intensity={blurIntensity}
              tint={blurTint}
              style={StyleSheet.absoluteFillObject}
            />
          </MaskedView>
        )}
        {showGradientOverlay && gradientColors && Platform.OS !== 'android' && (
          <LinearGradient
            colors={[
              opacity(gradientColors?.['300'], 0),
              opacity(gradientColors?.['300'], gradientOverlayOpacity),
            ]}
            locations={gradientLocations.overlayLocations}
            dither
            style={StyleSheet.absoluteFillObject}
          />
        )}
        {Platform.OS === 'android' ? (
          <>
            {showGradientOverlay && androidThemeMeshColors && (
              <MeshGradientView
                columns={SCROLL_OVERLAY_MESH_COLUMNS}
                rows={SCROLL_OVERLAY_MESH_ROWS}
                colors={androidThemeMeshColors}
                points={androidMeshPoints}
                resolution={SCROLL_OVERLAY_MESH_RESOLUTION}
                smoothsColors
                style={StyleSheet.absoluteFillObject}
              />
            )}
            <MeshGradientView
              columns={SCROLL_OVERLAY_MESH_COLUMNS}
              rows={SCROLL_OVERLAY_MESH_ROWS}
              colors={androidBackgroundMeshColors}
              points={androidMeshPoints}
              resolution={SCROLL_OVERLAY_MESH_RESOLUTION}
              smoothsColors
              style={StyleSheet.absoluteFillObject}
            />
          </>
        ) : (
          <LinearGradient
            colors={[opacity(primaryColor950, 0), opacity(primaryColor950, gradientOverlayOpacity)]}
            locations={gradientLocations.overlayLocations}
            dither
            style={StyleSheet.absoluteFillObject}
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
   * When set, applies a static full-screen blur at this intensity
   * instead of using the animated context-driven blur.
   */
  staticBlurIntensity?: number;
  /**
   * Opacity for the gradient overlay at the top edge (0-1).
   * @default 0 (transparent at top, matching the default behaviour)
   */
  gradientTopOpacity?: number;
  /**
   * Override the gradient overlay color. Defaults to the theme's
   * gradient dark color (scale '300').
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
  staticBlurIntensity,
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

  // Get animated values from context
  const { partialBlurOpacity, fullBlurOpacity, backgroundOpacity, backgroundColor } =
    useBackgroundContext();

  // Check if blur is supported on this device
  const blurSupported = supportsBlur();

  // Animated styles for partial blur overlay
  const partialBlurAnimatedStyle = useAnimatedStyle(() => ({
    opacity: partialBlurOpacity.value,
  }));

  // Animated styles for full blur overlay
  const fullBlurAnimatedStyle = useAnimatedStyle(() => ({
    opacity: fullBlurOpacity.value,
  }));

  // Animated styles for background opacity
  const backgroundAnimatedStyle = useAnimatedStyle(() => ({
    opacity: backgroundOpacity.value,
  }));

  // Animated styles for background color (use theme default if empty)
  const backgroundColorAnimatedStyle = useAnimatedStyle(() => ({
    backgroundColor: backgroundColor.value || surface,
  }));

  return (
    <Log name="AnimatedBackgroundView">
      <View style={[styles.container, style]}>
        {/* Base background color - configurable, defaults to primary-900 */}
        <Animated.View style={[StyleSheet.absoluteFillObject, backgroundColorAnimatedStyle]} />

        {/* Animated background image or solid color - with configurable opacity */}
        <Animated.View style={[StyleSheet.absoluteFillObject, backgroundAnimatedStyle]}>
          {showBackgroundImage && <AnimatedSpriteBackground backgroundColor={surface} />}

          {useMeshGradient ? (
            <MeshGradientView
              columns={3}
              rows={3}
              colors={meshGradientColors}
              points={BACKGROUND_MESH_POINTS}
              resolution={BACKGROUND_MESH_RESOLUTION}
              smoothsColors
              style={StyleSheet.absoluteFillObject}
            />
          ) : (
            /* Gradient overlay for image themes */
            (gradientColors || gradientColor) && (
              <LinearGradient
                colors={[
                  opacity(gradientColor || gradientColors!['300'], gradientTopOpacity),
                  opacity(gradientColor || gradientColors!['300'], 1),
                ]}
                locations={[0, 1]}
                dither
                style={StyleSheet.absoluteFillObject}
                pointerEvents="none"
              />
            )
          )}
        </Animated.View>

        {/* Static full blur — used by contexts like the drawer that don't need animated transitions */}
        {staticBlurIntensity != null && blurSupported && (
          <BlurView
            intensity={staticBlurIntensity}
            tint={blurTint}
            style={StyleSheet.absoluteFillObject}
          />
        )}

        {/* Partial blur overlay (bottom half) - animated opacity */}
        {staticBlurIntensity == null && blurSupported && (
          <Animated.View
            style={[
              StyleSheet.absoluteFillObject,
              { top: 'auto', height: '50%' },
              partialBlurAnimatedStyle,
            ]}
            pointerEvents="none">
            <MaskedView
              style={StyleSheet.absoluteFillObject}
              maskElement={
                <LinearGradient
                  colors={['transparent', 'rgba(0, 0, 0, 0.95)']}
                  locations={[0, 1]}
                  style={StyleSheet.absoluteFillObject}
                />
              }>
              <BlurView intensity={200} tint={blurTint} style={StyleSheet.absoluteFillObject} />
            </MaskedView>
          </Animated.View>
        )}

        {/* Full blur overlay - animated opacity */}
        {staticBlurIntensity == null && blurSupported && (
          <Animated.View
            style={[StyleSheet.absoluteFillObject, fullBlurAnimatedStyle]}
            pointerEvents="none">
            <BlurView intensity={200} tint={blurTint} style={StyleSheet.absoluteFillObject} />
          </Animated.View>
        )}

        {/* Content */}
        <View style={[styles.content]}>{children}</View>
      </View>
    </Log>
  );
}

export const AnimatedBackgroundView = memo(AnimatedBackgroundViewComponent);
