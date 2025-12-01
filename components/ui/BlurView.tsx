/**
 * @fileoverview BlurView Component - Platform-aware blur effect wrapper
 *
 * @module components/ui/BlurView
 *
 * @description
 * **A wrapper around expo-blur's BlurView that automatically handles platform support**
 * - Checks device compatibility before rendering blur effects
 * - Returns null on unsupported devices (iOS < 13, Android < 31)
 * - Passes through all props to the underlying BlurView when supported
 *
 * **Supported platforms:**
 * - iOS 13+ for consistent vibrancy and blur rendering
 * - Android 12+ (API 31) for native blur support
 * - macOS 14+ for NSVisualEffectView support
 *
 * @example
 * // Use exactly like expo-blur's BlurView
 * import { BlurView } from 'components/ui/BlurView';
 *
 * <BlurView intensity={70} tint="prominent" style={styles.blur}>
 *   <Text>Content over blur</Text>
 * </BlurView>
 */

import React from 'react';
import { BlurView as ExpoBlurView, BlurViewProps as ExpoBlurViewProps } from 'expo-blur';
import { supportsBlur } from 'helper/version';

/**
 * Props for the BlurView component - same as expo-blur's BlurViewProps
 */
export type BlurViewProps = ExpoBlurViewProps;

/**
 * Platform-aware BlurView that only renders on supported devices
 *
 * @component
 * @param {BlurViewProps} props - All props from expo-blur's BlurView
 * @returns {JSX.Element | null} BlurView on supported devices, null otherwise
 *
 * @example
 * <BlurView intensity={100} tint="dark" style={StyleSheet.absoluteFillObject} />
 */
export function BlurView(props: BlurViewProps): React.ReactElement | null {
  if (!supportsBlur()) {
    return null;
  }

  return <ExpoBlurView {...props} />;
}

export default BlurView;

