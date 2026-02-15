import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';
import { useTheme } from 'providers/ThemeProvider';
import { useBackgroundContext } from 'providers/BackgroundProvider';
import React, { memo, ReactNode, useMemo } from 'react';
import { Dimensions, StyleSheet, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSettingsStore } from 'stores/settingsStore';
import { isBackgroundImageTheme, getGradientColorScale } from 'config/backgroundImageThemes';
import AnimatedSpriteBackground from './SpriteView';
import { View } from 'components/ui/View/View';
import { BlurView } from './BlurView';
import { supportsBlur } from 'helper/version';

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
  const { getPrimaryColor } = useTheme();
  const primaryColor950 = useMemo(() => getPrimaryColor('950'), [getPrimaryColor]);

  const viewportHeight = Dimensions.get('window').height;

  // Get gradient colors for background image themes
  const currentTheme = useSettingsStore((state) => state.getTheme());
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

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: overlayHeight,
      }}
      pointerEvents="none">
      <MaskedView
        style={StyleSheet.absoluteFillObject}
        maskElement={
          <LinearGradient
            colors={['transparent', 'transparent', 'black', 'black']}
            locations={gradientLocations.maskLocations}
            style={StyleSheet.absoluteFillObject}
          />
        }>
        <BlurView intensity={blurIntensity} tint={blurTint} style={StyleSheet.absoluteFillObject} />
      </MaskedView>
      {showGradientOverlay && gradientColors && (
        <LinearGradient
          colors={[
            opacity(gradientColors?.['300'], 0),
            opacity(gradientColors?.['300'], gradientOverlayOpacity),
          ]}
          locations={gradientLocations.overlayLocations}
          style={StyleSheet.absoluteFillObject}
        />
      )}
      <LinearGradient
        colors={[opacity(primaryColor950, 0), opacity(primaryColor950, gradientOverlayOpacity)]}
        locations={gradientLocations.overlayLocations}
        style={StyleSheet.absoluteFillObject}
      />
    </View>
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
}: AnimatedBackgroundViewProps) {
  const { getPrimaryColor } = useTheme();
  const primaryColor900 = useMemo(() => getPrimaryColor('900'), [getPrimaryColor]);

  // Get gradient colors for background image themes
  const currentTheme = useSettingsStore((state) => state.getTheme());
  const gradientColors = useMemo(() => {
    if (isBackgroundImageTheme(currentTheme)) {
      return getGradientColorScale(currentTheme);
    }
    return null;
  }, [currentTheme]);

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
    backgroundColor: backgroundColor.value || primaryColor900,
  }));

  return (
    <View style={[styles.container, style]}>
      {/* Base background color - configurable, defaults to primary-900 */}
      <Animated.View style={[StyleSheet.absoluteFillObject, backgroundColorAnimatedStyle]} />

      {/* Animated background image or solid color - with configurable opacity */}
      <Animated.View style={[StyleSheet.absoluteFillObject, backgroundAnimatedStyle]}>
        <AnimatedSpriteBackground backgroundColor={primaryColor900} />

        {/* Gradient overlay for image themes */}
        {gradientColors && (
          <LinearGradient
            colors={[opacity(gradientColors['300'], 0), opacity(gradientColors['300'], 1)]}
            locations={[0, 1]}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />
        )}
      </Animated.View>

      {/* Partial blur overlay (bottom half) - animated opacity */}
      {blurSupported && (
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
      {blurSupported && (
        <Animated.View
          style={[StyleSheet.absoluteFillObject, fullBlurAnimatedStyle]}
          pointerEvents="none">
          <BlurView intensity={200} tint={blurTint} style={StyleSheet.absoluteFillObject} />
        </Animated.View>
      )}

      {/* Content */}
      <View style={[styles.content]}>{children}</View>
    </View>
  );
}

export const AnimatedBackgroundView = memo(AnimatedBackgroundViewComponent);
