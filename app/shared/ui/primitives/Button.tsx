/**
 * @fileoverview Button Component - Advanced button with blur support
 *
 * @module shared/ui/primitives/Button
 *
 * @description
 * **Comprehensive button component with advanced visual effects and multiple modes**
 * - Multiple variants (primary, secondary, dangerous, underline)
 * - Blur effects for enhanced visual appeal
 * - Icon-only, text-only, and combined modes
 * - Loading states with animated spinners
 * - Theme integration with dynamic colors
 *
 * **Features:**
 * - Blur effects with customizable intensity and tint
 * - Button variants with theme-aware colors
 * - Loading states with animated spinners
 * - Icon and text content support
 * - Accessibility and testing support
 *
 * **Usage:**
 * ```typescript
 * // Basic text button
 * <Button text="Save" onPress={handleSave} variant="primary" />
 *
 * // Button with blur effect
 * <Button text="Action" onPress={handleAction} blur />
 *
 * // Loading button
 * <Button text="Processing" onPress={handleProcess} loading />
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

import React, { useState } from 'react';
import { StyleProp, ViewStyle, GestureResponderEvent, Platform, StyleSheet } from 'react-native';
import { withAlpha } from '@/shared/lib/color';
import { Text } from '@/shared/ui/primitives/Text';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { controlHeight, fontSize } from '@/shared/styles/tokens';
import { Pressable, type HapticConfig } from './Pressable';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spinner } from '@/shared/ui/primitives/Spinner';

// Buttons sit close to the bottom-bar gradient and the home indicator, where
// off-by-a-few-pixel taps are common. An 8pt slop on every side is small
// enough not to overlap adjacent buttons in the standard footer layout but
// catches the misses that previously felt like "the button isn't pressing."
const BUTTON_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

/**
 * Button variant types
 *
 * @typedef {'primary' | 'secondary' | 'dangerous' | 'underline'} ButtonVariant
 * @description
 * - 'primary': Light background with dark text (high contrast)
 * - 'secondary': Dark background with light text (medium contrast)
 * - 'dangerous': Red background with light text (warning/danger actions)
 * - 'underline': Text action with no background and an underline
 */
type ButtonVariant = 'primary' | 'secondary' | 'dangerous' | 'underline';

/**
 * Button size variant.
 *
 * - `default` is the chunky CTA used in modal sheets / page footers.
 * - `compact` is for inline chips that sit alongside other UI (chat
 *   composer action row, top bars). Smaller minimum height, tighter
 *   padding, no auto-margin so siblings stay flush.
 */
type ButtonSize = 'default' | 'compact';

/**
 * Per-size layout tokens. The Button rendering paths read from this map so
 * adding a new size means adding one entry — no scattered conditionals.
 *
 * `iconOnlyDimension` is the square fallback for an icon-only button (no
 * text); `iconTextSpacing` is the gap between icon and text inside the
 * HStack when both are present.
 */
const SIZES: Record<
  ButtonSize,
  {
    paddingVertical: number;
    paddingHorizontal: number;
    minHeight: number;
    iconOnlyDimension: number;
    iconTextSpacing: number;
    fontSize: number;
    margin: number;
    marginBottom: number;
  }
> = {
  default: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: controlHeight.cta,
    iconOnlyDimension: 52,
    iconTextSpacing: 8,
    fontSize: fontSize.md,
    margin: 4,
    marginBottom: 8,
  },
  compact: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: controlHeight.compact,
    iconOnlyDimension: 40,
    iconTextSpacing: 6,
    fontSize: fontSize.sm,
    margin: 0,
    marginBottom: 0,
  },
};

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
  /** Button size — `default` for CTA buttons, `compact` for inline chips. */
  size?: ButtonSize;
  /** Text content or React node for the button */
  text?: string | React.ReactNode;
  /** Press event handler */
  onPress: (event: GestureResponderEvent) => Promise<void> | void;
  /** Icon content for the button */
  icon?: React.ReactNode;
  /** Additional style overrides */
  style?: StyleProp<ViewStyle>;
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
 * Advanced Button component with blur support
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
 * // Button with blur effect
 * <Button text="Action" onPress={handleAction} blur />
 *
 * // Loading button
 * <Button text="Processing" onPress={handleProcess} loading />
 */
export const Button = ({
  disabled = false,
  loading = false,
  variant = 'primary',
  size = 'default',
  text,
  onPress,
  icon,
  style,
  testID,
  blur = false,
  haptics = false,
  accessibilityLabel,
  accessibilityHint,
}: ButtonProps) => {
  const sz = SIZES[size];
  // Hold the last non-loading content so the button keeps its width while the
  // spinner shows. Adjusted during render rather than cached in a ref: reading
  // a ref during render is the rule violation that made the React Compiler skip
  // this whole component (10 functions), and this component is the app's button
  // primitive.
  //
  // `Object.is`, not `!==`: `ReactNode` admits numbers, and `text={NaN}` would
  // make a `!==` guard permanently true — an unbounded render loop rather than
  // the single convergent retry this pattern relies on.
  //
  // Cost, measured: when a caller passes an identity-unstable node (an inline
  // `<Icon/>` from a parent the compiler did not memoize) a non-loading update
  // costs one extra, discarded render attempt. Only `ModelChip` does that today.
  const [stableContent, setStableContent] = useState<{
    text?: React.ReactNode;
    icon?: React.ReactNode;
  }>({ text, icon });
  if (!loading && !(Object.is(stableContent.text, text) && Object.is(stableContent.icon, icon))) {
    setStableContent({ text, icon });
  }
  const layoutText = loading ? stableContent.text : text;
  const layoutIcon = loading ? stableContent.icon : icon;
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
  const [foreground, foregroundSecondary, surfaceSecondary, background, danger] = useThemeColor([
    'foreground',
    'muted',
    'surface-secondary',
    'background',
    'danger',
  ] as const);

  // Blur config
  const blurConfig = typeof blur === 'object' ? blur : {};
  const { intensity = 75, tint = 'dark' } = blurConfig;

  const shouldUseBlur = variant === 'underline' ? false : blur !== false;

  /**
   * Gets button styles based on variant and effect configuration
   *
   * @description
   * Calculates appropriate styling for the button based on variant,
   * and blur effects. Handles different visual modes and theme integration.
   *
   * **Process:** Define base styles → check blur mode → apply variant colors
   * **Effects:** Returns appropriate ViewStyle object for button container
   *
   * @returns {ViewStyle} Style object for button container
   *
   * @example
   * getButtonStyles() // Returns base styles with primary variant colors
   * // With blur=true: Returns base styles without border
   */
  const getButtonStyles = () => {
    const isAndroid = Platform.OS === 'android';
    // Padding lives on the outer container so all three rendering modes
    // (icon-only, text-only, icon+text) share the same horizontal/vertical
    // breathing room. Inner content (icon, text) renders without its own
    // padding, and the HStack's `spacing` controls the icon↔text gap. This
    // is what makes the icon+text layout look balanced — previously the
    // text wrapper carried its own paddingHorizontal while the icon had
    // none, so the icon was always pulled to one side.
    const base = {
      margin: sz.margin,
      marginBottom: sz.marginBottom,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      paddingVertical: sz.paddingVertical,
      paddingHorizontal: sz.paddingHorizontal,
      borderRadius: 9999,
      borderWidth: isAndroid ? 1 : 0.33,
      overflow: 'hidden' as const,
      opacity: disabled || loading ? 0.5 : 1,
    };

    if (shouldUseBlur) {
      return {
        ...base,
        borderWidth: 0,
      };
    }

    switch (variant) {
      case 'underline':
        return {
          ...base,
          backgroundColor: 'transparent',
          borderWidth: 0,
          overflow: 'visible' as const,
        };
      case 'primary':
        return {
          ...base,
          backgroundColor: foreground,
          borderColor: withAlpha(foregroundSecondary, 0.25),
        };
      case 'secondary':
        return {
          ...base,
          backgroundColor: surfaceSecondary,
          borderColor: withAlpha(foregroundSecondary, 0.25),
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
    if (Platform.OS === 'android' && variant === 'secondary') {
      return foreground;
    }

    switch (variant) {
      case 'primary':
        return background;
      case 'secondary':
      case 'dangerous':
      case 'underline':
      default:
        return variant === 'underline' ? foregroundSecondary : foreground;
    }
  };

  // Re-entrancy guard, haptic timing, and opacity feedback all live in
  // the shared `Pressable` primitive below — Button used to reimplement each one.

  // Icon-only: a fixed square. Override the outer paddings to 0 because the
  // dimension *is* the visual size — extra padding would push the icon off-
  // center and grow the hit area beyond what's drawn.
  if (!layoutText && layoutIcon) {
    return (
      <Pressable
        testID={testID}
        disabled={disabled || loading}
        onPress={onPress}
        haptics={haptics}
        hitSlop={BUTTON_HIT_SLOP}
        {...a11yProps}>
        <View
          style={[
            getButtonStyles(),
            {
              width: sz.iconOnlyDimension,
              height: sz.iconOnlyDimension,
              paddingVertical: 0,
              paddingHorizontal: 0,
            },
            style,
          ]}
          blur={shouldUseBlur}
          blurIntensity={intensity}
          blurTint={tint}>
          {/* Loading spinner or icon content */}
          {loading ? <Spinner size={16} /> : layoutIcon}
        </View>
      </Pressable>
    );
  }

  // Text-only or icon+text. Padding is on the outer container (via
  // `getButtonStyles`); the inner HStack is responsible only for the gap
  // between icon and text. ReactNode `text` renders inline (no wrapper)
  // so things like the ModelChip's `<HStack>label + chevron</HStack>`
  // sit flush against the icon at the right `iconTextSpacing`.
  return (
    <Pressable
      testID={testID}
      disabled={disabled || loading}
      onPress={onPress}
      haptics={haptics}
      hitSlop={BUTTON_HIT_SLOP}
      {...a11yProps}>
      <View
        style={[getButtonStyles(), { minHeight: sz.minHeight }, style]}
        blur={shouldUseBlur}
        blurIntensity={intensity}
        blurTint={tint}>
        <HStack
          collapsable={false}
          align="center"
          justify="center"
          gap={layoutText && layoutIcon ? sz.iconTextSpacing : 0}
          style={loading ? styles.hiddenContent : undefined}>
          <>
            {layoutIcon}
            {layoutText != null &&
              (typeof layoutText === 'string' ? (
                <Text
                  style={{
                    color: getTextColor(),
                    fontFamily: 'OxygenBold',
                    textAlign: 'center',
                    ...(variant === 'underline'
                      ? { textDecorationLine: 'underline' as const }
                      : undefined),
                  }}
                  size={sz.fontSize}>
                  {layoutText}
                </Text>
              ) : (
                layoutText
              ))}
          </>
        </HStack>
        {loading ? (
          <View pointerEvents="none" style={styles.loadingOverlay}>
            <Spinner size={16} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  hiddenContent: {
    opacity: 0,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
