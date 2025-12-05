import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Animated, View } from 'react-native';
import { Text, CustomTextProps } from './Text';
import { Skeleton } from './Skeleton';
import { useTheme } from 'providers/ThemeProvider';

interface AnimatedTextProps extends CustomTextProps {
  /**
   * Controls skeleton visibility. When true, shows skeleton. When false, animates to text.
   */
  loading?: boolean;
  /**
   * Optional ref for manual animation control. If provided, auto-trigger is disabled.
   */
  onTriggerAnimationRef?: React.MutableRefObject<(() => void) | null>;
  /**
   * Optional custom skeleton width. If not provided, will be estimated from content.
   */
  skeletonWidth?: number;
  /**
   * Optional custom skeleton height. Defaults to matching text size.
   */
  skeletonHeight?: number;
  /**
   * Optional custom skeleton color. Defaults to the color prop if provided, otherwise uses theme default.
   */
  skeletonColor?: string;
  /**
   * Children to render as text content
   */
  children?: React.ReactNode;
}

/**
 * AnimatedText Component
 *
 * A reusable text component that smoothly animates from a skeleton loading state to the actual text.
 * Optimized for performance by removing expensive layout measurements and style parsing.
 *
 * @example
 * ```tsx
 * <AnimatedText loading={isLoading} size={16} bold>
 *   {displayName}
 * </AnimatedText>
 * ```
 *
 * @example
 * ```tsx
 * const animationRef = useRef<(() => void) | null>(null);
 * <AnimatedText
 *   loading={false}
 *   onTriggerAnimationRef={animationRef}
 *   size={24}
 * >
 *   {text}
 * </AnimatedText>
 * // Trigger manually: animationRef.current?.();
 * ```
 */
export function AnimatedText({
  loading = false,
  onTriggerAnimationRef,
  skeletonWidth,
  skeletonHeight,
  skeletonColor,
  size = 14,
  children,
  style,
  color,
  ...textProps
}: AnimatedTextProps) {
  const { getPrimaryColor } = useTheme();

  // Animation values
  const skeletonOpacity = useRef(new Animated.Value(loading ? 1 : 0)).current;
  const textOpacity = useRef(new Animated.Value(loading ? 0 : 1)).current;

  // Track measured text width and position (only if skeletonWidth not provided)
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const [textLayout, setTextLayout] = useState<{ x: number; width: number } | null>(null);
  const hasMeasuredRef = useRef(false);

  // Track if we have data (not loading and has children)
  const hasData = !loading && children !== undefined && children !== null;

  // Get skeleton color - use skeletonColor prop if provided, otherwise use color prop, otherwise default
  const finalSkeletonColor = skeletonColor || color || getPrimaryColor('700');

  // Measure text width and position
  // Lock in width after first measurement to prevent skeleton from changing size when content animates
  const handleTextLayout = useCallback(
    (event: any) => {
      const { x, width } = event.nativeEvent.layout;
      // Only measure width once if skeletonWidth is not provided
      if (skeletonWidth === undefined && !hasMeasuredRef.current && width > 0) {
        setMeasuredWidth(width);
        hasMeasuredRef.current = true;
      }
      // Always track text position for skeleton alignment (even if width is locked)
      if (width > 0) {
        setTextLayout({ x, width });
      }
    },
    [skeletonWidth]
  );

  // Trigger animation function - useCallback with empty deps since it only uses refs
  const triggerAnimation = useCallback(() => {
    skeletonOpacity.setValue(1);
    textOpacity.setValue(0);

    Animated.parallel([
      Animated.timing(skeletonOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(textOpacity, {
        toValue: 1,
        duration: 300,
        delay: 50,
        useNativeDriver: true,
      }),
    ]).start();
  }, [skeletonOpacity, textOpacity]);

  // Expose triggerAnimation via ref
  useEffect(() => {
    if (onTriggerAnimationRef) {
      onTriggerAnimationRef.current = triggerAnimation;
      return () => {
        onTriggerAnimationRef.current = null;
      };
    }
  }, [onTriggerAnimationRef, triggerAnimation]);

  // Trigger animation when data becomes available (only if parent doesn't control via ref)
  const hasTriggeredRef = useRef(false);
  useEffect(() => {
    if (onTriggerAnimationRef) {
      return;
    }

    if (hasData && !hasTriggeredRef.current) {
      hasTriggeredRef.current = true;
      // Small delay to ensure component is rendered
      const timeoutId = setTimeout(triggerAnimation, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [hasData, onTriggerAnimationRef, triggerAnimation]);

  // Calculate skeleton dimensions
  const skeletonHeightValue = skeletonHeight || size;
  // Use provided skeletonWidth, or measured width, or default fallback
  const finalSkeletonWidth = skeletonWidth ?? measuredWidth ?? 200;
  const showSkeleton = loading || !hasData;

  return (
    <View style={{ position: 'relative', alignItems: 'center' }}>
      {/* Skeleton */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          // Center skeleton: if we have text layout, align to text's center, otherwise use 50% with margin
          ...(textLayout
            ? {
                left: textLayout.x + (textLayout.width - finalSkeletonWidth) / 2,
              }
            : {
                left: '50%',
                marginLeft: -finalSkeletonWidth / 2,
              }),
          opacity: skeletonOpacity,
          pointerEvents: showSkeleton ? 'auto' : 'none',
        }}>
        <Skeleton
          className=""
          style={{
            width: finalSkeletonWidth,
            height: skeletonHeightValue,
            backgroundColor: finalSkeletonColor,
          }}
        />
      </Animated.View>

      {/* Text */}
      <Animated.View
        style={{
          opacity: textOpacity,
        }}>
        <Text
          capHeight={size}
          color={color}
          style={style}
          onLayout={handleTextLayout}
          {...textProps}>
          {children}
        </Text>
      </Animated.View>
    </View>
  );
}
