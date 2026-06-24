import { LinearGradient } from 'expo-linear-gradient';
import { MeshGradientView } from 'expo-mesh-gradient';
import opacity from 'hex-color-opacity';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useBackgroundContext } from '@/shared/providers/BackgroundProvider';
import React, { ReactNode, useMemo } from 'react';
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
  const androidMeshPoints = getScrollableOverlayMeshPoints(
    overlayLocations[0],
    overlayLocations[1]
  );
  const androidBackgroundMeshColors = getScrollableOverlayMeshColors({
    top: opacity(screenBackgroundColor, 0),
    mid: screenBackgroundColor,
    bottom: screenBackgroundColor,
  });
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
            style={StyleSheet.absoluteFillObject}
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
            style={StyleSheet.absoluteFillObject}
          />
        )}
      </View>
    </Log>
  );
}

export const ScrollableGradientOverlay = React.memo(ScrollableGradientOverlayComponent);

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
  const meshGradientColors = getMeshGradientColors(gradientColors, gradientColor || surface);

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

  const backgroundAnimatedStyle = useAnimatedStyle(() => ({
    opacity: backgroundOpacity.value,
  }));

  const backgroundColorAnimatedStyle = useAnimatedStyle(() => ({
    backgroundColor: backgroundColor.value || surface,
  }));

  return (
    <Log name="AnimatedBackgroundView">
      <View style={[styles.container, style]}>
        {/* Base background color */}
        <Animated.View style={[StyleSheet.absoluteFillObject, backgroundColorAnimatedStyle]} />

        {/* Animated background image plus optional theme fade */}
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
                  opacity(gradientColor || surface, gradientTopOpacity),
                  gradientColor || surface,
                ]}
                locations={[0, 1]}
                dither
                style={StyleSheet.absoluteFillObject}
                pointerEvents="none"
              />
            )
          )}
        </Animated.View>

        {blurSupported && (
          <Animated.View
            style={[StyleSheet.absoluteFillObject, fullBlurAnimatedStyle]}
            pointerEvents="none">
            <BlurView intensity={200} tint={blurTint} style={StyleSheet.absoluteFillObject} />
          </Animated.View>
        )}

        <View style={[styles.content]}>{children}</View>
      </View>
    </Log>
  );
}

export const AnimatedBackgroundView = React.memo(AnimatedBackgroundViewComponent);
