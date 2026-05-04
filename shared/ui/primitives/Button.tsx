/**
 * @fileoverview Button Component - Advanced button with ripple effects and blur support
 *
 * @module shared/ui/primitives/Button
 *
 * @description
 * **Comprehensive button component with advanced visual effects and multiple modes**
 * - Multiple variants (primary, secondary, dangerous)
 * - Ripple effect animations with customizable configuration
 * - Blur effects for enhanced visual appeal
 * - Icon-only, text-only, and combined modes
 * - Loading states with animated spinners
 * - Theme integration with dynamic colors
 *
 * **Features:**
 * - Ripple effect animations with position tracking
 * - Blur effects with customizable intensity and tint
 * - Three button variants with theme-aware colors
 * - Loading states with animated spinners
 * - Icon and text content support
 * - Accessibility and testing support
 *
 * **Usage:**
 * ```typescript
 * // Basic text button
 * <Button text="Save" onPress={handleSave} variant="primary" />
 *
 * // Icon-only button with ripple
 * <Button icon={<Icon name="save" />} onPress={handleSave} ripple />
 *
 * // Button with blur effect
 * <Button text="Action" onPress={handleAction} blur />
 *
 * // Loading button
 * <Button text="Processing" onPress={handleProcess} loading />
 *
 * // Custom ripple configuration
 * <Button
 *   text="Custom"
 *   onPress={handleCustom}
 *   ripple={{ color: 'blue', duration: 600 }}
 * />
 *
 * // Button with haptic feedback
 * <Button text="Haptic" onPress={handleHaptic} haptics />
 *
 * // Custom haptic configuration
 * <Button
 *   text="Impact"
 *   onPress={handleImpact}
 *   haptics={{ type: 'impact', impactStyle: 'heavy' }}
 * />
 * ```
 *
 * @see {@link ./Pressable}
 * @see {@link ./View}
 * @see {@link ./Text}
 */

import React, { useRef, useState, useCallback } from 'react';
import {
  StyleProp,
  ViewStyle,
  Animated,
  LayoutChangeEvent,
  GestureResponderEvent,
} from 'react-native';
import { Text } from '@/shared/ui/primitives/Text';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import Icon from 'assets/icons';
import { Pressable, type HapticConfig } from './Pressable';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';

// Buttons sit close to the bottom-bar gradient and the home indicator, where
// off-by-a-few-pixel taps are common. An 8pt slop on every side is small
// enough not to overlap adjacent buttons in the standard footer layout but
// catches the misses that previously felt like "the button isn't pressing."
const BUTTON_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

/**
 * Configuration for ripple effect animations
 *
 * @interface RippleConfig
 * @description
 * Controls the visual appearance and behavior of ripple effects
 * when the button is pressed.
 */
interface RippleConfig {
  /** Color of the ripple effect (default: 'rgba(255,255,255,0.8)') */
  color?: string;
  /** Opacity of the ripple effect (default: 0.3) */
  opacity?: number;
  /** Duration of the ripple animation in milliseconds (default: 400) */
  duration?: number;
  /** Whether ripple should be centered or follow touch position (default: true) */
  centered?: boolean;
}

/**
 * Options for the useRipple hook
 *
 * @interface UseRippleOptions
 * @description
 * Configuration object for enabling and customizing ripple effects.
 */
interface UseRippleOptions {
  /** Whether ripple effects are enabled */
  enabled: boolean;
  /** Ripple configuration object */
  config: RippleConfig;
}

/**
 * Custom hook for managing ripple effect animations
 *
 * @description
 * Provides ripple effect functionality for buttons with customizable animations.
 * Tracks touch position, manages animation values, and provides handlers for
 * layout and press events. Supports both centered and touch-positioned ripples.
 *
 * **Process:** Initialize state → handle layout → handle press → animate ripple
 * **Effects:** Creates animated ripple effects on button press
 *
 * @param {UseRippleOptions} options - Configuration for ripple effects
 * @returns {Object} Ripple effect handlers and state
 * @returns {Function} returns.handleLayout - Layout event handler
 * @returns {Function} returns.handlePressIn - Press event handler
 * @returns {Function} returns.getRippleStyle - Style generator for ripple
 * @returns {boolean} returns.shouldShowRipple - Whether to show ripple
 *
 * @example
 * const { handleLayout, handlePressIn, getRippleStyle, shouldShowRipple } = useRipple({
 *   enabled: true,
 *   config: { color: 'blue', duration: 600, centered: false }
 * });
 */
const useRipple = ({ enabled, config }: UseRippleOptions) => {
  const [rippleSize, setRippleSize] = useState(0);
  const [buttonSize, setButtonSize] = useState({ width: 0, height: 0 });
  const [ripplePosition, setRipplePosition] = useState({ x: 0, y: 0 });
  const rippleScale = useRef(new Animated.Value(0)).current;
  const rippleOpacity = useRef(new Animated.Value(0)).current;

  const {
    color = 'rgba(255,255,255,0.8)',
    opacity = 0.3,
    duration = 400,
    centered = true,
  } = config;

  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      if (!enabled) return;
      const { width, height } = e.nativeEvent.layout;
      setButtonSize({ width, height });
      setRippleSize(Math.max(width, height) * 2);
    },
    [enabled]
  );

  const handlePressIn = useCallback(
    (event: GestureResponderEvent) => {
      if (!enabled) return;

      // Calculate ripple position
      if (!centered && event.nativeEvent) {
        const { locationX, locationY } = event.nativeEvent;
        setRipplePosition({ x: locationX, y: locationY });
      } else {
        setRipplePosition({ x: buttonSize.width / 2, y: buttonSize.height / 2 });
      }

      rippleScale.setValue(0);
      rippleOpacity.setValue(opacity);
      Animated.parallel([
        Animated.timing(rippleScale, {
          toValue: 1,
          duration,
          useNativeDriver: true,
        }),
        Animated.timing(rippleOpacity, {
          toValue: 0,
          duration,
          useNativeDriver: true,
        }),
      ]).start();
    },
    [enabled, centered, buttonSize, rippleScale, rippleOpacity, opacity, duration]
  );

  const getRippleStyle = useCallback(
    () => ({
      position: 'absolute' as const,
      top: ripplePosition.y - rippleSize / 2,
      left: ripplePosition.x - rippleSize / 2,
      width: rippleSize,
      height: rippleSize,
      borderRadius: rippleSize / 2,
      backgroundColor: color,
      transform: [{ scale: rippleScale }],
      opacity: rippleOpacity,
    }),
    [ripplePosition, rippleSize, color, rippleScale, rippleOpacity]
  );

  return {
    handleLayout,
    handlePressIn,
    getRippleStyle,
    shouldShowRipple: enabled,
  };
};

/**
 * Button variant types
 *
 * @typedef {'primary' | 'secondary' | 'dangerous'} ButtonVariant
 * @description
 * - 'primary': Light background with dark text (high contrast)
 * - 'secondary': Dark background with light text (medium contrast)
 * - 'dangerous': Red background with light text (warning/danger actions)
 */
type ButtonVariant = 'primary' | 'secondary' | 'dangerous';

/**
 * Configuration for blur effects
 *
 * @interface BlurConfig
 * @description
 * Controls the visual appearance of blur effects applied to buttons.
 */
interface BlurConfig {
  /** Intensity of the blur effect (default: 75) */
  intensity?: number;
  /** Tint color for the blur effect */
  tint?: 'light' | 'dark' | 'default' | 'prominent';
}

/**
 * Props for the Button component
 *
 * @interface ButtonProps
 * @description
 * Comprehensive props interface supporting multiple button modes,
 * visual effects, and interaction states.
 */
interface ButtonProps {
  /** Test identifier for automated testing */
  testID?: string;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Whether the button is in loading state */
  loading?: boolean;
  /** Button variant determining visual style */
  variant?: ButtonVariant;
  /** Text content or React node for the button */
  text?: string | React.ReactNode;
  /** Press event handler */
  onPress: (event: any) => Promise<void> | void;
  /** Icon content for the button */
  icon?: React.ReactNode;
  /** Additional style overrides */
  style?: StyleProp<ViewStyle>;
  /** Ripple effect configuration (boolean or config object) */
  ripple?: boolean | RippleConfig;
  /** Blur effect configuration (boolean or config object) */
  blur?: boolean | BlurConfig;
  /** Haptic feedback configuration (boolean or config object) */
  haptics?: boolean | HapticConfig;
  /** VoiceOver/TalkBack label. Defaults to `text` when `text` is a string;
   *  required for icon-only buttons since the glyph carries no name. */
  accessibilityLabel?: string;
  /** Optional VoiceOver hint describing the action's outcome. */
  accessibilityHint?: string;
}

/**
 * Advanced Button component with ripple effects and blur support
 *
 * @component
 * @param {ButtonProps} props - Component props
 * @returns {JSX.Element}
 *
 * @description
 * **Process:** Configure effects → calculate styles → determine layout mode → render appropriate button type
 * **Effects:** Renders button with theme colors, animations, and appropriate content layout
 *
 * @example
 * // Basic text button
 * <Button text="Save" onPress={handleSave} variant="primary" />
 *
 * // Icon-only button with ripple
 * <Button icon={<Icon name="save" />} onPress={handleSave} ripple />
 *
 * // Button with blur effect
 * <Button text="Action" onPress={handleAction} blur />
 *
 * // Loading button
 * <Button text="Processing" onPress={handleProcess} loading />
 *
 * // Custom ripple configuration
 * <Button
 *   text="Custom"
 *   onPress={handleCustom}
 *   ripple={{ color: 'blue', duration: 600 }}
 * />
 */
export const Button = ({
  disabled = false,
  loading = false,
  variant = 'primary',
  text,
  onPress,
  icon,
  style,
  testID,
  ripple = false,
  blur = false,
  haptics = false,
  accessibilityLabel,
  accessibilityHint,
}: ButtonProps) => {
  // Derive a sensible default label from `text` when it's a string so the
  // common case ("primary CTA with visible copy") needs no extra prop.
  // Icon-only and ReactNode-text callers must supply `accessibilityLabel`
  // explicitly — we cannot read text out of a node tree.
  const a11yLabel = accessibilityLabel ?? (typeof text === 'string' ? text : undefined);
  const a11yProps = {
    accessibilityRole: 'button' as const,
    accessibilityLabel: a11yLabel,
    accessibilityHint,
    accessibilityState: { disabled: disabled || loading, busy: loading },
  };
  const [foreground, surfaceForeground, foregroundSecondary, surfaceTertiary, background, danger] =
    useThemeColor([
      'foreground',
      'surface-foreground',
      'muted',
      'surface-tertiary',
      'background',
      'danger',
    ] as const);

  // Ripple hook
  const rippleConfig = typeof ripple === 'object' ? ripple : {};
  const {
    handleLayout: handleRippleLayout,
    handlePressIn: handleRipplePressIn,
    getRippleStyle,
    shouldShowRipple,
  } = useRipple({
    enabled: !!ripple,
    config: rippleConfig,
  });

  // Blur config
  const blurConfig = typeof blur === 'object' ? blur : {};
  const { intensity = 75, tint = 'dark' } = blurConfig;

  const shouldUseBlur = blur !== false;

  /**
   * Gets button styles based on variant and effect configuration
   *
   * @description
   * Calculates appropriate styling for the button based on variant, ripple mode,
   * and blur effects. Handles different visual modes and theme integration.
   *
   * **Process:** Define base styles → check ripple mode → check blur mode → apply variant colors
   * **Effects:** Returns appropriate ViewStyle object for button container
   *
   * @returns {ViewStyle} Style object for button container
   *
   * @example
   * getButtonStyles() // Returns base styles with primary variant colors
   * // With ripple=true: Returns minimal styles for ripple mode
   * // With blur=true: Returns base styles without border
   */
  const getButtonStyles = () => {
    // Standard Button styling
    const base = {
      margin: 4, // m-1, but 0 if noPadding
      marginBottom: 8, // mb-2, but 0 if noPadding
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      paddingVertical: 4, // py-1
      borderRadius: 9999, // rounded-full
      borderWidth: 0.33, // border-[0.33px]
      overflow: 'hidden' as const,
      opacity: disabled || loading ? 0.5 : 1,
    };

    // If ripple is enabled, use minimal styling like original RippleButton
    if (ripple) {
      return {
        overflow: 'hidden' as const,
        position: 'relative' as const,
        opacity: disabled || loading ? 0.5 : 1,
      };
    }

    if (shouldUseBlur) {
      return {
        ...base,
        borderWidth: 0,
      };
    }

    switch (variant) {
      case 'primary':
        return {
          ...base,
          backgroundColor: foreground,
          borderColor: surfaceForeground,
        };
      case 'secondary':
        return {
          ...base,
          backgroundColor: surfaceTertiary,
          borderColor: foregroundSecondary,
        };
      case 'dangerous':
        return {
          ...base,
          backgroundColor: danger,
          borderColor: danger,
        };
      default:
        return base;
    }
  };

  /**
   * Gets text color based on button variant
   *
   * @description
   * Determines appropriate text color for optimal contrast against
   * the button's background color based on the variant.
   *
   * **Process:** Switch on variant → return appropriate theme color
   * **Effects:** Ensures proper contrast and readability
   *
   * @returns {string} Color string for text content
   *
   * @example
   * getTextColor() // Returns theme color based on variant
   * // With variant="primary": Returns dark color for light background
   * // With variant="secondary": Returns light color for dark background
   */
  const getTextColor = () => {
    switch (variant) {
      case 'primary':
        return background;
      case 'secondary':
      case 'dangerous':
      default:
        return foreground;
    }
  };

  // Re-entrancy guard, haptic timing, and opacity feedback all live in
  // the shared `Pressable` primitive below — Button used to reimplement
  // each one. `onPressIn` here is purely the ripple-animation hook;
  // Pressable runs its own haptic('start') ahead of this callback.

  // Ripple mode: behaves like original RippleButton (minimal styling, direct content)
  if (ripple) {
    return (
      <Pressable
        testID={testID}
        disabled={disabled || loading}
        onPress={onPress}
        onLayout={handleRippleLayout}
        onPressIn={handleRipplePressIn}
        haptics={haptics}
        hitSlop={BUTTON_HIT_SLOP}
        {...a11yProps}
        style={[getButtonStyles(), style]}>
        {/* Ripple effect overlay */}
        {shouldShowRipple && <Animated.View pointerEvents="none" style={getRippleStyle()} />}
        {/* Content rendering - string text or React node */}
        {typeof text === 'string' ? (
          <Text
            size={16}
            bold
            style={{
              color: getTextColor(),
            }}>
            {text}
          </Text>
        ) : (
          text || icon
        )}
      </Pressable>
    );
  }

  // Icon only button (no text) - fixed size with centered content
  if (!text && icon) {
    return (
      <Pressable
        testID={testID}
        disabled={disabled || loading}
        onPress={onPress}
        onLayout={handleRippleLayout}
        onPressIn={handleRipplePressIn}
        haptics={haptics}
        hitSlop={BUTTON_HIT_SLOP}
        {...a11yProps}>
        <View
          style={[getButtonStyles(), { width: 52, height: 52, position: 'relative' }, style]}
          blur={shouldUseBlur}
          blurIntensity={intensity}
          blurTint={tint}>
          {/* Ripple effect overlay */}
          {shouldShowRipple && <Animated.View pointerEvents="none" style={getRippleStyle()} />}
          {/* Loading spinner or icon content */}
          {loading ? (
            <Icon
              name="ant-design:loading-outlined"
              size={16}
              spin={{
                delay: 0,
                duration: 1000,
                outputRange: ['0deg', '360deg'],
                easing: 'linear',
              }}
            />
          ) : (
            icon
          )}
        </View>
      </Pressable>
    );
  }

  // Text button (with optional icon) - flexible width with proper spacing
  return (
    <Pressable
      testID={testID}
      disabled={disabled || loading}
      onPress={onPress}
      onLayout={handleRippleLayout}
      onPressIn={handleRipplePressIn}
      haptics={haptics}
      hitSlop={BUTTON_HIT_SLOP}
      {...a11yProps}>
      <View
        style={[getButtonStyles(), { position: 'relative', minHeight: 48 }, style]}
        blur={shouldUseBlur}
        blurIntensity={intensity}
        blurTint={tint}>
        {/* Ripple effect overlay */}
        {shouldShowRipple && <Animated.View pointerEvents="none" style={getRippleStyle()} />}
        {/* Content layout with proper spacing */}
        <HStack align="center" justify="center" spacing={text && icon && !loading ? 8 : 0}>
          {/* Loading state or content */}
          {loading ? (
            <Icon
              name="ant-design:loading-outlined"
              size={16}
              spin={{
                delay: 0,
                duration: 1000,
                outputRange: ['0deg', '360deg'],
                easing: 'linear',
              }}
            />
          ) : (
            <>
              {/* Icon content */}
              {icon}
              {/* Text content — string gets the default OxygenBold wrapper;
                  ReactNode renders inline so callers can drop in custom
                  primitives like AmountFormatter without triggering a
                  View-in-Text nesting error on Android. */}
              {text &&
                (typeof text === 'string' ? (
                  <Text
                    style={{
                      color: getTextColor(),
                      fontFamily: 'OxygenBold',
                      paddingVertical: 12,
                      textAlign: 'center',
                    }}
                    size={14}>
                    {text}
                  </Text>
                ) : (
                  <View style={{ paddingVertical: 12 }}>{text}</View>
                ))}
            </>
          )}
        </HStack>
      </View>
    </Pressable>
  );
};
