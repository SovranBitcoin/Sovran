/**
 * @fileoverview Collapsing Header Component
 *
 * A custom header that animates between large and small title states
 * based on scroll position. This avoids the unreliable native iOS
 * large title behavior in React Navigation.
 *
 * Based on the Revolut-style collapsing header pattern.
 */

import React, { useCallback } from 'react';
import { StyleSheet, View as RNView } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  interpolate,
  Extrapolation,
  SharedValue,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { View } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { useTheme } from 'providers/ThemeProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Height constants
const LARGE_TITLE_HEIGHT = 52;
const SMALL_TITLE_HEIGHT = 44;
const COLLAPSE_THRESHOLD = 50; // Scroll distance to fully collapse

interface CollapsingHeaderProps {
  /** The title text */
  title: string;
  /** Left header button (e.g., back/close) */
  headerLeft?: React.ReactNode;
  /** Right header button (e.g., filter) */
  headerRight?: React.ReactNode;
  /** Content to show below the header when expanded (e.g., month selector) */
  stickyContent?: React.ReactNode;
  /** Current scroll offset - should be an Animated value from scroll view */
  scrollY: SharedValue<number>;
  /** Background color */
  backgroundColor?: string;
}

export function CollapsingHeader({
  title,
  headerLeft,
  headerRight,
  stickyContent,
  scrollY,
}: CollapsingHeaderProps) {
  const { getPrimaryColor } = useTheme();
  const insets = useSafeAreaInsets();

  // Animated styles for the large title
  const largeTitleStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollY.value,
      [0, COLLAPSE_THRESHOLD * 0.5],
      [1, 0],
      Extrapolation.CLAMP
    );
    const translateY = interpolate(
      scrollY.value,
      [0, COLLAPSE_THRESHOLD],
      [0, -20],
      Extrapolation.CLAMP
    );
    const scale = interpolate(
      scrollY.value,
      [0, COLLAPSE_THRESHOLD],
      [1, 0.8],
      Extrapolation.CLAMP
    );

    return {
      opacity,
      transform: [{ translateY }, { scale }],
    };
  });

  // Animated styles for the small title (in the header bar)
  const smallTitleStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollY.value,
      [COLLAPSE_THRESHOLD * 0.5, COLLAPSE_THRESHOLD],
      [0, 1],
      Extrapolation.CLAMP
    );

    return {
      opacity,
    };
  });

  // Animated height for the large title container
  const largeTitleContainerStyle = useAnimatedStyle(() => {
    const height = interpolate(
      scrollY.value,
      [0, COLLAPSE_THRESHOLD],
      [LARGE_TITLE_HEIGHT, 0],
      Extrapolation.CLAMP
    );

    return {
      height,
      overflow: 'hidden',
    };
  });

  return (
    <RNView style={[styles.container, { paddingTop: insets.top }]}>
      {/* Progressive blur using MaskedView - blur fades from top to bottom */}
      <MaskedView
        style={StyleSheet.absoluteFill}
        maskElement={
          <LinearGradient
            colors={['black', 'black', 'transparent', 'transparent']}
            locations={[0, 0.6, 0.9, 1]}
            style={StyleSheet.absoluteFill}
          />
        }>
        <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
        <LinearGradient
          colors={[getPrimaryColor('950'), 'transparent', 'transparent']}
          locations={[0, 0.9, 1]}
          style={StyleSheet.absoluteFill}
        />
      </MaskedView>

      {/* Small header bar */}
      <View style={[styles.headerBar, { height: SMALL_TITLE_HEIGHT }]}>
        <View style={styles.headerLeft}>{headerLeft}</View>

        <Animated.View style={[styles.smallTitleContainer, smallTitleStyle]}>
          <Text
            size={17}
            style={{
              color: getPrimaryColor('0'),
              fontFamily: 'OverpassBold',
            }}>
            {title}
          </Text>
        </Animated.View>

        <View style={styles.headerRight}>{headerRight}</View>
      </View>

      {/* Large title - collapses on scroll */}
      <Animated.View style={largeTitleContainerStyle}>
        <Animated.View style={[styles.largeTitleContainer, largeTitleStyle]}>
          <Text
            size={34}
            style={{
              color: getPrimaryColor('0'),
              fontFamily: 'OverpassHeavy',
            }}>
            {title}
          </Text>
        </Animated.View>
      </Animated.View>

      {/* Sticky content (e.g., month selector) */}
      {stickyContent}
    </RNView>
  );
}

/**
 * Hook to create scroll tracking for the collapsing header
 */
export function useCollapsingHeader() {
  const scrollY = useSharedValue(0);

  const scrollHandler = useCallback(
    (event: { nativeEvent: { contentOffset: { y: number } } }) => {
      'worklet';
      scrollY.value = Math.max(0, event.nativeEvent.contentOffset.y);
    },
    [scrollY]
  );

  return {
    scrollY,
    scrollHandler,
  };
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    overflow: 'hidden',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  headerLeft: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRight: {
    position: 'relative',
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallTitleContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  largeTitleContainer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    transformOrigin: 'left center',
  },
});

export default CollapsingHeader;
