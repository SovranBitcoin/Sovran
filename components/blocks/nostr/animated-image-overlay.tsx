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
import {
  DISMISS_ACTIVE_OFFSET_Y,
  DISMISS_BLUR_AT_REST,
  DISMISS_CLOSE_BTN_FADE_DURATION_MS,
  DISMISS_DRAG_FOLLOW,
  DISMISS_DRAG_RANGE_FRACTION,
  DISMISS_FAIL_OFFSET_X,
  DISMISS_MIN_DISTANCE,
  DISMISS_SCALE_AT_DRAG,
  DISMISS_THRESHOLD_FRACTION,
  DOTS_ACTIVE_COLOR,
  DOTS_GAP,
  DOTS_OPACITY_INPUT,
  DOTS_OPACITY_OUTPUT,
  DOTS_SCALE_INPUT,
  DOTS_SCALE_OUTPUT,
  DOTS_SIZE,
  IMAGE_WRAP_BORDER_RADIUS,
  PAGER_ACTIVE_OFFSET_X,
  PAGER_FAIL_OFFSET_Y,
  PAGER_FLICK_VELOCITY_THRESHOLD,
  PAGER_MIN_DISTANCE,
  PAGER_VELOCITY_CLAMP,
  PAGER_VELOCITY_WEIGHT,
  SNAP_SPRING_PAGE_CHANGE,
  SNAP_SPRING_SAME_PAGE,
  CLOSE_BUTTON_BG,
  CLOSE_BUTTON_LEFT,
  CLOSE_BUTTON_PADDING,
  CLOSE_BUTTON_TOP_OFFSET,
  DOT_PAGER_BOTTOM,
} from './image-overlay.config';

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

const DOT_CONTAINER_WIDTH = DOTS_SIZE + DOTS_GAP;

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
      [...DOTS_SCALE_INPUT],
      [...DOTS_SCALE_OUTPUT],
      Extrapolation.CLAMP
    );
    const opacity = interpolate(
      Math.abs(position),
      [...DOTS_OPACITY_INPUT],
      [...DOTS_OPACITY_OUTPUT],
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
    width: DOTS_SIZE,
    height: DOTS_SIZE,
    borderRadius: DOTS_SIZE / 2,
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
          activeOffsetY: `[-${DISMISS_ACTIVE_OFFSET_Y}, ${DISMISS_ACTIVE_OFFSET_Y}] (dismiss activates after ${DISMISS_ACTIVE_OFFSET_Y}px vertical)`,
          failOffsetX: `[-${DISMISS_FAIL_OFFSET_X}, ${DISMISS_FAIL_OFFSET_X}] (dismiss fails if ${DISMISS_FAIL_OFFSET_X}px horizontal first)`,
        },
        pager: {
          activeOffsetX: `[-${PAGER_ACTIVE_OFFSET_X}, ${PAGER_ACTIVE_OFFSET_X}] (pager activates after ${PAGER_ACTIVE_OFFSET_X}px horizontal)`,
          failOffsetY: `[-${PAGER_FAIL_OFFSET_Y}, ${PAGER_FAIL_OFFSET_Y}] (pager fails if ${PAGER_FAIL_OFFSET_Y}px vertical first)`,
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

  /** Fade dots with the same curve as blur/close button during dismiss. */
  const rDotPagerStyle = useAnimatedStyle(() => ({
    opacity: closeBtnOpacity.value,
  }));

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(DISMISS_MIN_DISTANCE)
        .activeOffsetY([-DISMISS_ACTIVE_OFFSET_Y, DISMISS_ACTIVE_OFFSET_Y])
        .failOffsetX([-DISMISS_FAIL_OFFSET_X, DISMISS_FAIL_OFFSET_X])
        .onStart(() => {
          dismissPanActive.value = 1;
          scheduleOnRN(logPerfPanStart);
          scheduleOnRN(logDismissPanStart);
          panStartX.value = imageXCoord.value;
          panStartY.value = imageYCoord.value;
          closeBtnOpacity.value = withTiming(0, {
            duration: DISMISS_CLOSE_BTN_FADE_DURATION_MS,
          });
        })
        .onChange((event) => {
          if (imageState.value === 'close') return;
          imageXCoord.value += event.changeX * DISMISS_DRAG_FOLLOW;
          imageYCoord.value += event.changeY * DISMISS_DRAG_FOLLOW;
          const deltaX = imageXCoord.value - panStartX.value;
          const deltaY = imageYCoord.value - panStartY.value;
          const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
          const dragRange = screenWidth * DISMISS_DRAG_RANGE_FRACTION;
          const scale = interpolate(distance, [0, dragRange], [1, DISMISS_SCALE_AT_DRAG], {
            extrapolateRight: 'clamp',
          });
          const blur = interpolate(distance, [0, dragRange], [DISMISS_BLUR_AT_REST, 0], {
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
          const threshold = Math.max(expandedWidth, expandedHeight) * DISMISS_THRESHOLD_FRACTION;
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

  const horizontalPan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(hasMultipleImages)
        .activeOffsetX([-PAGER_ACTIVE_OFFSET_X, PAGER_ACTIVE_OFFSET_X])
        .failOffsetY([-PAGER_FAIL_OFFSET_Y, PAGER_FAIL_OFFSET_Y])
        .minDistance(PAGER_MIN_DISTANCE)
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
          const effective = current + velocity * PAGER_VELOCITY_WEIGHT;
          let snapTo = Math.max(0, Math.min(maxPagerIndex, Math.round(effective)));
          const startIndex = Math.round(startPagerOffsetSv.value);
          if (velocity >= PAGER_FLICK_VELOCITY_THRESHOLD && startIndex < maxPagerIndex) {
            snapTo = startIndex + 1;
          } else if (velocity <= -PAGER_FLICK_VELOCITY_THRESHOLD && startIndex > 0) {
            snapTo = startIndex - 1;
          }
          const didChangePage = snapTo !== startIndex;
          scheduleOnRN(
            logPagerPanEnd,
            e.translationX,
            e.velocityX,
            snapTo,
            startIndex,
            didChangePage
          );
          const initialVelocity = didChangePage
            ? 0
            : Math.max(-PAGER_VELOCITY_CLAMP, Math.min(PAGER_VELOCITY_CLAMP, velocity));
          const springConfig = didChangePage ? SNAP_SPRING_PAGE_CHANGE : SNAP_SPRING_SAME_PAGE;
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
          <Pressable
            onPress={triggerClose}
            style={[styles.closeButton, { top: insets.top + CLOSE_BUTTON_TOP_OFFSET }]}>
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
                  <Animated.View style={[styles.dotPager, rDotPagerStyle]} pointerEvents="none">
                    {activeUrls.map((_, i) => (
                      <OverlayDot
                        key={i}
                        index={i}
                        pagerOffsetSv={pagerOffsetSv}
                        activeColor={DOTS_ACTIVE_COLOR}
                      />
                    ))}
                  </Animated.View>
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
    left: CLOSE_BUTTON_LEFT,
    backgroundColor: CLOSE_BUTTON_BG,
    padding: CLOSE_BUTTON_PADDING,
    borderRadius: 9999,
  },
  imageWrap: {
    position: 'absolute',
    borderRadius: IMAGE_WRAP_BORDER_RADIUS,
    overflow: 'hidden',
    transformOrigin: 'center',
  },
  dotPager: {
    position: 'absolute',
    bottom: DOT_PAGER_BOTTOM,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
