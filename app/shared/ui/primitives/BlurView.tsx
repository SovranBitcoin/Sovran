/**
 * @fileoverview BlurView Component - Platform-aware blur effect wrapper
 *
 * @module shared/ui/primitives/BlurView
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
 * import { BlurView } from '@/shared/ui/primitives/BlurView';
 *
 * <BlurView intensity={70} tint="prominent" style={styles.blur}>
 *   <Text>Content over blur</Text>
 * </BlurView>
 */

import React from 'react';
import { Platform } from 'react-native';
import {
  BlurView as ExpoBlurView,
  BlurViewProps as ExpoBlurViewProps,
  type BlurTint,
} from 'expo-blur';
import { supportsBlur } from '@/shared/lib/version';

/**
 * The tint every chrome surface (bottom button bars, scroll edge fades) blurs
 * with. iOS's system material renders true frosted glass that composes
 * correctly through a gradient mask; plain `'dark'` is a tinted overlay, not a
 * blur, and is all Android has. Platform-awareness for blur belongs to this
 * module, so the constant lives here rather than being re-derived per surface.
 */
export const CHROME_BLUR_TINT: BlurTint =
  Platform.OS === 'ios' ? 'systemChromeMaterialDark' : 'dark';

/**
 * Props for the BlurView component - same as expo-blur's BlurViewProps
 */
type BlurViewProps = ExpoBlurViewProps;

/**
 * Platform-aware BlurView that only renders on supported devices
 *
 * @component
 * @param {BlurViewProps} props - All props from expo-blur's BlurView
 * @returns {JSX.Element | null} BlurView on supported devices, null otherwise
 *
 * @example
 * <BlurView intensity={100} tint="dark" style={StyleSheet.absoluteFill} />
 */
export function BlurView(props: BlurViewProps): React.ReactElement | null {
  if (!supportsBlur()) {
    return null;
  }

  return <ExpoBlurView {...props} />;
}
