/**
 * Fullscreen image overlay with blur, pan-to-dismiss, and tap-to-close.
 * Renders only when ImageOverlayProvider is present and activeUrl is set.
 *
 * Performance logging (__DEV__ only, filter by [ImageOverlay:Perf]):
 * - mount/unmount, render count (re-renders)
 * - pan gesture: onStart, onFinalize (distance, threshold, dismissed)
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'assets/icons';
import type { ImageOverlayContextValue } from './image-overlay-provider';
import { IMAGE_OVERLAY_TIMING_CONFIG, useImageOverlay } from './image-overlay-provider';

function logPerfOverlayMount() {
  if (__DEV__) console.log('[ImageOverlay:Perf] AnimatedImageOverlayContent mounted');
}
function logPerfOverlayUnmount() {
  if (__DEV__) console.log('[ImageOverlay:Perf] AnimatedImageOverlayContent unmounted');
}
function logPerfOverlayRender(renderCount: number) {
  if (__DEV__) console.log('[ImageOverlay:Perf] AnimatedImageOverlayContent render #', renderCount);
}
function logPerfPanStart() {
  if (__DEV__) console.log('[ImageOverlay:Perf] pan onStart');
}
function logPerfPanFinalize(distance: number, threshold: number, dismissed: boolean) {
  if (__DEV__) {
    console.log('[ImageOverlay:Perf] pan onFinalize', {
      distance: Math.round(distance),
      threshold: Math.round(threshold),
      dismissed,
    });
  }
}

// Gesture debug logs (filter by [ImageOverlay:Gesture])
function logDismissPanStart() {
  if (__DEV__) console.log('[ImageOverlay:Gesture] DISMISS pan onStart (vertical drag-to-dismiss)');
}
function logDismissPanFinalize(
  tx: number,
  ty: number,
  distance: number,
  threshold: number,
  dismissed: boolean
) {
  if (__DEV__) {
    console.log('[ImageOverlay:Gesture] DISMISS pan onFinalize', {
      translationX: Math.round(tx),
      translationY: Math.round(ty),
      distance: Math.round(distance),
      threshold: Math.round(threshold),
      dismissed,
      action: dismissed ? 'CLOSING overlay' : 'snapping back to center',
    });
  }
}
function logPagerPanStart() {
  if (__DEV__) console.log('[ImageOverlay:Gesture] PAGER pan onStart (horizontal page swipe)');
}
function logPagerPanEnd(
  tx: number,
  velocityX: number,
  snapTo: number,
  startIndex: number,
  didChangePage: boolean
) {
  if (__DEV__) {
    console.log('[ImageOverlay:Gesture] PAGER pan onEnd', {
      translationX: Math.round(tx),
      velocityX: Math.round(velocityX),
      snapTo,
      startIndex,
      didChangePage,
      action: didChangePage ? 'CHANGING page' : 'staying on same page',
    });
  }
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

/** Fixed-size page for pager; no animated styles (layout is stable). */
function PagerPage({
  url,
  style,
}: {
  url: string;
  style: { left: number; width: number; height: number };
}) {
  return (
    <View style={[style, { position: 'absolute', top: 0 }]} pointerEvents="none">
      <Image
        source={{ uri: url }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
      />
    </View>
  );
}

const MemoizedPagerPage = React.memo(PagerPage);

// Instagram-style animated dots: scale by distance from current page (bell curve)
const DOT_SIZE = 6;
const DOT_GAP = 4;
const DOT_CONTAINER_WIDTH = DOT_SIZE + DOT_GAP;

function OverlayDot({
  index,
  pagerOffsetSv,
  activeColor,
}: {
  index: number;
  pagerOffsetSv: SharedValue<number>;
  activeColor: string;
}) {
  const animatedDotStyle = useAnimatedStyle(() => {
    const position = index - pagerOffsetSv.value;
    const scale = interpolate(
      position,
      [-2, -1, 0, 1, 2],
      [0.3, 0.7, 1, 0.7, 0.3],
      Extrapolation.CLAMP
    );
    // Drive opacity from position so the "current" dot is always brightest without waiting on JS state
    const opacity = interpolate(
      Math.abs(position),
      [0, 0.5, 1],
      [1, 0.85, 0.4],
      Extrapolation.CLAMP
    );
    return {
      transform: [{ scale }],
      opacity,
    };
  });

  return (
    <View style={overlayDotStyles.container}>
      <Animated.View
        style={[overlayDotStyles.dot, animatedDotStyle, { backgroundColor: activeColor }]}
      />
    </View>
  );
}

const overlayDotStyles = StyleSheet.create({
  container: {
    width: DOT_CONTAINER_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
});

function AnimatedImageOverlayContent({ ctx }: { ctx: ImageOverlayContextValue }) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  useEffect(() => {
    logPerfOverlayMount();
    return logPerfOverlayUnmount;
  }, []);

  useEffect(() => {
    if (__DEV__) logPerfOverlayRender(renderCountRef.current);
  });

  const imageScale = useSharedValue(1);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const dismissPanActive = useSharedValue(0);

  const {
    activeUrl,
    activeUrls,
    activeIndex,
    setActiveIndex,
    imageState,
    imageXCoord,
    imageYCoord,
    imageWidth,
    imageHeight,
    blurIntensity,
    closeBtnOpacity,
    expandedWidth,
    expandedHeight,
    close,
    openToCenter,
  } = ctx;

  const hasMultipleImages = activeUrls.length > 1;
  const maxPagerIndex = Math.max(0, activeUrls.length - 1);

  useEffect(() => {
    if (__DEV__ && hasMultipleImages) {
      console.log('[ImageOverlay:Gesture] Config (multi-image)', {
        dismiss: {
          activeOffsetY: '[-14, 14] (dismiss activates after 14px vertical)',
          failOffsetX: '[-32, 32] (dismiss fails only if 32px horizontal first)',
        },
        pager: {
          activeOffsetX: '[-20, 20] (pager activates after 20px horizontal)',
          failOffsetY: '[-8, 8] (pager fails if 12px vertical first)',
        },
        expected: 'Horizontal swipe → PAGER. Vertical swipe → DISMISS.',
      });
    }
  }, [hasMultipleImages]);

  const pagerOffsetSv = useSharedValue(activeIndex);
  const startPagerOffsetSv = useSharedValue(activeIndex);

  useEffect(() => {
    pagerOffsetSv.value = activeIndex;
  }, [activeIndex, pagerOffsetSv]);

  const rContainerStyle = useAnimatedStyle(() => ({
    pointerEvents: imageState.value === 'open' ? 'auto' : 'none',
    opacity: imageState.value === 'open' ? 1 : 0,
  }));

  const rImageStyle = useAnimatedStyle(() => ({
    left: imageXCoord.value,
    top: imageYCoord.value,
    width: imageWidth.value,
    height: imageHeight.value,
    opacity: imageState.value === 'open' ? 1 : 0,
    overflow: 'hidden' as const,
    transform: [{ scale: imageScale.value }],
  }));

  const rPagerScaleStyle = useAnimatedStyle(() => {
    'worklet';
    const w = imageWidth.value;
    const h = imageHeight.value;
    const scaleX = expandedWidth > 0 ? w / expandedWidth : 1;
    const scaleY = expandedHeight > 0 ? h / expandedHeight : 1;
    // Compensate for default center origin: translate so scaled content's top-left stays at (0,0)
    const translateX = (expandedWidth * (scaleX - 1)) / 2;
    const translateY = (expandedHeight * (scaleY - 1)) / 2;
    return {
      width: expandedWidth,
      height: expandedHeight,
      overflow: 'hidden' as const,
      transform: [{ translateX }, { translateY }, { scaleX }, { scaleY }],
    };
  }, [expandedWidth, expandedHeight]);

  const urlCount = activeUrls.length;
  const rPagerRowStyle = useAnimatedStyle(() => {
    'worklet';
    const x = -pagerOffsetSv.value * expandedWidth;
    return {
      width: expandedWidth * Math.max(1, urlCount),
      height: expandedHeight,
      transform: [{ translateX: x }],
    };
  }, [expandedWidth, expandedHeight, urlCount]);

  const backdropAnimatedProps = useAnimatedProps(() => ({
    intensity: blurIntensity.value,
  }));

  const rCloseBtnStyle = useAnimatedStyle(() => ({
    opacity: closeBtnOpacity.value,
  }));

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(6)
        .activeOffsetY([-14, 14])
        .failOffsetX([-32, 32])
        .onStart(() => {
          dismissPanActive.value = 1;
          scheduleOnRN(logPerfPanStart);
          scheduleOnRN(logDismissPanStart);
          panStartX.value = imageXCoord.value;
          panStartY.value = imageYCoord.value;
          closeBtnOpacity.value = withTiming(0, { duration: 200 });
        })
        .onChange((event) => {
          if (imageState.value === 'close') return;
          imageXCoord.value += event.changeX * 0.85;
          imageYCoord.value += event.changeY * 0.85;
          const deltaX = imageXCoord.value - panStartX.value;
          const deltaY = imageYCoord.value - panStartY.value;
          const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
          const dragRange = screenWidth * 0.35;
          const scale = interpolate(distance, [0, dragRange], [1, 0.9], {
            extrapolateRight: 'clamp',
          });
          const blur = interpolate(distance, [0, dragRange], [100, 0], {
            extrapolateRight: 'clamp',
          });
          imageScale.value = scale;
          blurIntensity.value = blur;
        })
        .onFinalize((event) => {
          const wasActive = dismissPanActive.value === 1;
          dismissPanActive.value = 0;
          const deltaX = imageXCoord.value - panStartX.value;
          const deltaY = imageYCoord.value - panStartY.value;
          const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
          const threshold = Math.max(expandedWidth, expandedHeight) / 4;
          const dismissed = distance > threshold;
          scheduleOnRN(logPerfPanFinalize, distance, threshold, dismissed);
          scheduleOnRN(
            logDismissPanFinalize,
            event.translationX,
            event.translationY,
            distance,
            threshold,
            dismissed
          );
          imageScale.value = withTiming(1, IMAGE_OVERLAY_TIMING_CONFIG);
          if (!wasActive) return;
          if (dismissed) {
            close();
          } else {
            openToCenter();
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared values are stable refs
    [expandedWidth, expandedHeight, screenWidth]
  );

  const closeRef = useRef(close);
  closeRef.current = close;
  const triggerClose = useCallback(() => {
    const fn = closeRef.current;
    if (fn) scheduleOnUI(fn);
  }, []);

  const tapBackdrop = useMemo(
    () =>
      Gesture.Tap().onEnd((e) => {
        if (imageState.value === 'close') return;
        const x = e.x;
        const y = e.y;
        const ix = imageXCoord.value;
        const iy = imageYCoord.value;
        const iw = imageWidth.value;
        const ih = imageHeight.value;
        const insideImage = x >= ix && x <= ix + iw && y >= iy && y <= iy + ih;
        if (insideImage) return;
        runOnJS(triggerClose)();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- worklet reads shared values
    [triggerClose]
  );

  const SNAP_SPRING = {
    duration: 580,
    dampingRatio: 1,
  };
  /** Softer, longer settle when moving to the next/prev page so the animation eases into place instead of snapping. */
  const SNAP_SPRING_PAGE_CHANGE = {
    duration: 420,
    dampingRatio: 0.92,
  };

  const horizontalPan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(hasMultipleImages)
        .activeOffsetX([-20, 20])
        .failOffsetY([-8, 8])
        .minDistance(6)
        .onStart(() => {
          if (imageState.value !== 'open') return;
          scheduleOnRN(logPagerPanStart);
          startPagerOffsetSv.value = pagerOffsetSv.value;
        })
        .onChange((e) => {
          if (imageState.value !== 'open') return;
          const delta = -e.translationX / expandedWidth;
          const next = startPagerOffsetSv.value + delta;
          pagerOffsetSv.value = Math.max(0, Math.min(maxPagerIndex, next));
        })
        .onEnd((e) => {
          if (imageState.value !== 'open') return;
          const delta = -e.translationX / expandedWidth;
          const current = startPagerOffsetSv.value + delta;
          const velocity = -e.velocityX / expandedWidth;
          const VELOCITY_WEIGHT = 0.12;
          const effective = current + velocity * VELOCITY_WEIGHT;
          const snapTo = Math.max(0, Math.min(maxPagerIndex, Math.round(effective)));
          const startIndex = Math.round(startPagerOffsetSv.value);
          const didChangePage = snapTo !== startIndex;
          scheduleOnRN(
            logPagerPanEnd,
            e.translationX,
            e.velocityX,
            snapTo,
            startIndex,
            didChangePage
          );
          // Defer setActiveIndex until the spring finishes. Updating React state mid-animation causes the provider to re-render and run effects (e.g. closeTarget sync), which can interrupt the animation. Dots stay correct because they're driven by pagerOffsetSv.
          const initialVelocity = didChangePage ? 0 : Math.max(-12, Math.min(12, velocity));
          const springConfig = didChangePage ? SNAP_SPRING_PAGE_CHANGE : SNAP_SPRING;
          pagerOffsetSv.value = withSpring(
            snapTo,
            {
              ...springConfig,
              velocity: initialVelocity,
            },
            (finished) => {
              if (finished && didChangePage) {
                runOnJS(setActiveIndex)(snapTo);
              }
            }
          );
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared values stable refs
    [hasMultipleImages, expandedWidth, maxPagerIndex, setActiveIndex]
  );

  const composed = useMemo(
    () =>
      hasMultipleImages
        ? Gesture.Exclusive(horizontalPan, pan, tapBackdrop)
        : Gesture.Exclusive(pan, tapBackdrop),
    [hasMultipleImages, horizontalPan, pan, tapBackdrop]
  );

  return (
    <View
      style={[StyleSheet.absoluteFill, { zIndex: 9999 }]}
      pointerEvents={activeUrl ? 'auto' : 'none'}>
      <GestureDetector gesture={composed}>
        <AnimatedPressable style={[StyleSheet.absoluteFill, rContainerStyle]}>
          <AnimatedBlurView
            tint="dark"
            style={StyleSheet.absoluteFill}
            animatedProps={backdropAnimatedProps}
          />
          <Pressable onPress={triggerClose} style={[styles.closeButton, { top: insets.top + 16 }]}>
            <Animated.View style={rCloseBtnStyle}>
              <Icon name="material-symbols:close-rounded" size={22} color="#fff" />
            </Animated.View>
          </Pressable>
          {activeUrl ? (
            <Animated.View style={[styles.imageWrap, rImageStyle]}>
              {hasMultipleImages ? (
                <>
                  <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
                    <Animated.View style={rPagerScaleStyle}>
                      <Animated.View style={rPagerRowStyle}>
                        {activeUrls.map((url, i) => (
                          <MemoizedPagerPage
                            key={url}
                            url={url}
                            style={{
                              left: i * expandedWidth,
                              width: expandedWidth,
                              height: expandedHeight,
                            }}
                          />
                        ))}
                      </Animated.View>
                    </Animated.View>
                  </View>
                  <View style={styles.dotPager} pointerEvents="none">
                    {activeUrls.map((_, i) => (
                      <OverlayDot
                        key={i}
                        index={i}
                        pagerOffsetSv={pagerOffsetSv}
                        activeColor="rgba(255,255,255,0.95)"
                      />
                    ))}
                  </View>
                </>
              ) : (
                <Pressable style={StyleSheet.absoluteFill} onPress={() => {}}>
                  <Image
                    source={{ uri: activeUrl }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                </Pressable>
              )}
            </Animated.View>
          ) : null}
        </AnimatedPressable>
      </GestureDetector>
    </View>
  );
}

/**
 * Renders the image overlay. On native, wraps in FullWindowOverlay (from
 * react-native-screens) so it appears above the Expo Router tab bar and
 * header — same approach as VideoFeedOverlay.
 */
export function AnimatedImageOverlay() {
  const ctx = useImageOverlay();
  if (!ctx) return null;
  const content = <AnimatedImageOverlayContent ctx={ctx} />;
  if (Platform.OS === 'web') return content;
  return <FullWindowOverlay>{content}</FullWindowOverlay>;
}

const styles = StyleSheet.create({
  closeButton: {
    position: 'absolute',
    left: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 4,
    borderRadius: 9999,
  },
  imageWrap: {
    position: 'absolute',
    borderRadius: 12,
    overflow: 'hidden',
    transformOrigin: 'center',
  },
  dotPager: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
