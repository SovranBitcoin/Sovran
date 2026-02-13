/**
 * @fileoverview View Component - Enhanced React Native View with blur effects
 *
 * @module components/ui/View/View
 *
 * @description
 * **Enhanced View component with advanced blur effects and background handling**
 * - Native React Native View with additional blur capabilities
 * - Automatic background class stripping when blur is enabled
 * - Support for custom blur intensity and tint
 * - Color blur overlay support for enhanced visual effects
 *
 * **Features:**
 * - Blur effects using expo-blur
 * - Background class filtering for blur compatibility
 * - Custom blur intensity and tint configuration
 * - Color blur overlay support
 *
 * **Usage:**
 * ```typescript
 * // Basic usage
 * <View className="p-4 bg-primary-800">
 *   <Text>Content</Text>
 * </View>
 *
 * // With blur effect
 * <View blur blurIntensity={70} blurTint="prominent">
 *   <Text>Blurred content</Text>
 * </View>
 *
 * // With color blur overlay
 * <View blur colorBlur="rgba(255,0,0,0.3)">
 *   <Text>Red-tinted blur</Text>
 * </View>
 * ```
 *
 * @see {@link ./Spacer}
 * @see {@link ./VStack}
 * @see {@link ./HStack}
 */

import { BlurTint, BlurView } from 'expo-blur';
import React from 'react';
import { View as RNView, ViewProps as RNViewProps, StyleSheet } from 'react-native';
import { supportsBlur } from 'helper/version';

/**
 * Props for the View component
 *
 * @interface ViewProps
 * @extends RNViewProps
 */
export interface ViewProps extends RNViewProps {
  /** Enable blur effect on the view */
  blur?: boolean;
  /** Custom color overlay for blur effect */
  colorBlur?: string;
  /** Intensity of the blur effect (0-100) */
  blurIntensity?: number;
  /** Tint color for the blur effect */
  blurTint?: BlurTint;
  /** Child components */
  children?: React.ReactNode;
  /** Tailwind CSS classes */
  className?: string;
}

/**
 * Strips background-related Tailwind classes from className string
 *
 * This utility function removes background color and image classes that
 * would conflict with blur effects. It's used internally when blur is enabled
 * to ensure proper visual rendering.
 *
 * @param className - The className string to process
 * @returns Cleaned className string with background classes removed
 *
 * @example
 * stripBackgroundClasses('p-4 bg-primary-800 bg-gradient-to-r') // 'p-4'
 * stripBackgroundClasses('text-white') // 'text-white'
 * stripBackgroundClasses(undefined) // ''
 *
 * @private
 */
const stripBackgroundClasses = (className?: string): string => {
  if (!className) return '';

  // Split classes and filter out background-related ones
  const classes = className.split(' ').filter((cls) => {
    // Remove background color classes
    if (cls.startsWith('bg-')) return false;
    // Remove background image classes
    if (cls.startsWith('bg-[') || cls.startsWith('bg-gradient-')) return false;
    return true;
  });

  return classes.join(' ');
};

/**
 * Enhanced View component with blur effects and background handling
 *
 * @component
 * @param {ViewProps} props - Component props
 * @returns {JSX.Element}
 *
 * @description
 * **Process:** Check blur prop → strip background classes if needed → render with/without blur
 * **Effects:** Applies blur effects, manages background class conflicts
 *
 * @example
 * // Standard view
 * <View className="p-4 bg-primary-800">
 *   <Text>Normal content</Text>
 * </View>
 *
 * // Blurred view
 * <View blur blurIntensity={70} blurTint="prominent">
 *   <Text>Blurred content</Text>
 * </View>
 *
 * // Blur with color overlay
 * <View blur colorBlur="rgba(255,0,0,0.3)" blurIntensity={50}>
 *   <Text>Red-tinted blur</Text>
 * </View>
 */
const View = React.forwardRef<RNView, ViewProps>((props, ref) => {
  const {
    blur = false,
    blurIntensity = 70,
    blurTint = 'dark',
    style,
    children,
    className,
    ...rest
  } = props;

  const flattenedStyle = StyleSheet.flatten(style);
  const { backgroundColor: _backgroundColor, ...cleanStyle } = flattenedStyle || {};

  // Only enable blur if the device supports it
  const effectiveBlur = blur && supportsBlur();

  if (!effectiveBlur) {
    // 🔁 Normal unwrapped View – no blur requested or not supported
    return (
      <RNView ref={ref} style={style} className={className} {...rest}>
        {children}
      </RNView>
    );
  }

  // 🧊 Blur-enhanced View - works with or without background image
  // Strip background classes when blur is enabled
  const cleanClassName = stripBackgroundClasses(className);

  return (
    <RNView
      ref={ref}
      style={[
        cleanStyle,
        {
          overflow: 'hidden',
        },
      ]}
      className={cleanClassName}
      {...rest}>
      {rest.colorBlur && (
        <View
          style={{
            position: 'absolute',
            top: -1,
            left: -1,
            right: -1,
            bottom: -1,
            backgroundColor: rest.colorBlur,
          }}
        />
      )}
      <BlurView
        intensity={blurIntensity}
        tint={blurTint}
        style={{
          position: 'absolute',
          top: -1,
          left: -1,
          right: -1,
          bottom: -1,
        }}
      />

      {children}
    </RNView>
  );
});

View.displayName = 'View';

export { View };
