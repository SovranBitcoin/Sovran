/**
 * @fileoverview Device platform version checking utilities for React Native
 *
 * This module provides a fluent API for checking device platform versions
 * across different operating systems. It allows for easy version comparisons
 * using a chainable interface that supports various comparison operators.
 *
 * @example
 * // Check if running on iOS 10 or higher
 * if (device.platform('ios').gte(10)) {
 *   // iOS 10+ specific code
 * }
 *
 * // Check if running on Android 21 or higher
 * if (device.platform('android').gte(21)) {
 *   // Android 5.0+ specific code
 * }
 *
 * // Chain multiple checks
 * const isSupported = device.platform('ios').gte(12) || device.platform('android').gte(21);
 */

import { Platform } from 'react-native';

/**
 * Generic device platform version checking with fluent API
 *
 * This class provides a chainable interface for checking device platform versions.
 * It supports iOS, iPadOS, Android, Web, Windows, and macOS platforms with various
 * comparison operators (gt, gte, lt, lte, eq).
 *
 * @example
 * // Basic usage
 * device.platform('ios').gte(10) // true if iOS/iPadOS 10 or higher
 * device.platform('ipados').gte(13) // true if specifically iPadOS 13 or higher
 * device.platform('android').lt(21) // true if Android below 5.0
 *
 * // Chaining
 * const isSupported = device.platform('ios').gte(12) || device.platform('android').gte(21);
 */
class DeviceChecker {
  /** The target platform OS being checked */
  private platformOS: string | null = null;
  /** The parsed version number of the current platform */
  private platformVersion: number | null = null;

  /**
   * Sets the target platform for version checking
   *
   * This method configures the checker to target a specific platform and
   * parses the current platform's version number. For iOS and Android,
   * the version is parsed as an integer, while other platforms use float parsing.
   *
   * Note: 'ios' matches both iPhone and iPad. Use 'ipados' to specifically target iPads only.
   *
   * @param platform - The target platform to check ('ios', 'ipados', 'android', 'web', 'windows', 'macos')
   * @returns The DeviceChecker instance for method chaining
   *
   * @example
   * device.platform('ios') // Configure to check iOS version (includes iPad)
   * device.platform('ipados').gte(13) // Check if specifically iPad running iPadOS 13+
   * device.platform('android').gte(21) // Check if Android 5.0+
   */
  platform(platform: 'ios' | 'ipados' | 'android' | 'web' | 'windows' | 'macos'): DeviceChecker {
    this.platformOS = platform;

    // Handle iPadOS as a special case - it reports as 'ios' but we check Platform.isPad
    const isTargetPlatform =
      platform === 'ipados' ? Platform.OS === 'ios' && Platform.isPad : Platform.OS === platform;

    if (isTargetPlatform) {
      if (platform === 'ios' || platform === 'ipados' || platform === 'android') {
        // For iOS, iPadOS, and Android, parse the version as integer
        this.platformVersion = parseInt(Platform.Version as string, 10);
      } else {
        // For other platforms, use float parsing
        this.platformVersion = parseFloat(Platform.Version as string);
      }
    } else {
      this.platformVersion = null;
    }

    return this;
  }

  /**
   * Validates that the platform check is valid
   *
   * @private
   * @returns True if the platform matches the current OS and version is available
   */
  private isValidPlatform(): boolean {
    return this.platformOS === Platform.OS && this.platformVersion !== null;
  }

  /**
   * Checks if the current platform version is greater than the specified version
   *
   * @param version - The version number to compare against
   * @returns True if the current platform version is greater than the specified version
   *
   * @example
   * device.platform('ios').gt(10) // true if iOS 11 or higher
   * device.platform('android').gt(21) // true if Android 6.0 or higher
   */
  gt = (version: number): boolean => {
    if (!this.isValidPlatform()) return false;
    return this.platformVersion! > version;
  };

  /**
   * Checks if the current platform version is greater than or equal to the specified version
   *
   * @param version - The version number to compare against
   * @returns True if the current platform version is greater than or equal to the specified version
   *
   * @example
   * device.platform('ios').gte(10) // true if iOS 10 or higher
   * device.platform('android').gte(21) // true if Android 5.0 or higher
   */
  gte = (version: number): boolean => {
    if (!this.isValidPlatform()) return false;
    return this.platformVersion! >= version;
  };

  /**
   * Checks if the current platform version is less than the specified version
   *
   * @param version - The version number to compare against
   * @returns True if the current platform version is less than the specified version
   *
   * @example
   * device.platform('ios').lt(12) // true if iOS 11 or lower
   * device.platform('android').lt(23) // true if Android 5.1 or lower
   */
  lt = (version: number): boolean => {
    if (!this.isValidPlatform()) return false;
    return this.platformVersion! < version;
  };

  /**
   * Checks if the current platform version is less than or equal to the specified version
   *
   * @param version - The version number to compare against
   * @returns True if the current platform version is less than or equal to the specified version
   *
   * @example
   * device.platform('ios').lte(11) // true if iOS 11 or lower
   * device.platform('android').lte(22) // true if Android 5.1 or lower
   */
  lte = (version: number): boolean => {
    if (!this.isValidPlatform()) return false;
    return this.platformVersion! <= version;
  };

  /**
   * Checks if the current platform version is equal to the specified version
   *
   * @param version - The version number to compare against
   * @returns True if the current platform version exactly matches the specified version
   *
   * @example
   * device.platform('ios').eq(12) // true if exactly iOS 12
   * device.platform('android').eq(21) // true if exactly Android 5.0
   */
  eq = (version: number): boolean => {
    if (!this.isValidPlatform()) return false;
    return this.platformVersion! === version;
  };
}

/**
 * Pre-configured DeviceChecker instance for easy platform version checking
 *
 * This is the main export of the module, providing a ready-to-use instance
 * of the DeviceChecker class for checking platform versions throughout the application.
 *
 * @example
 * // Import and use
 * import { device } from '@/helper/version';
 *
 * if (device.platform('ios').gte(12)) {
 *   // iOS 12+ specific code
 * }
 */
const device = new DeviceChecker();

/**
 * Checks if the current device supports blur effects well
 *
 * Blur effects using expo-blur work best on:
 * - iOS 13+ for consistent vibrancy and blur rendering
 * - iPadOS 13+ for consistent vibrancy and blur rendering
 * - Android 12+ (API 31) for native blur support
 * - macOS 14+ for NSVisualEffectView support
 *
 * @returns True if the device supports blur effects reliably
 *
 * @example
 * import { supportsBlur } from '@/helper/version';
 *
 * if (supportsBlur()) {
 *   // Enable blur effects
 * } else {
 *   // Use solid background fallback
 * }
 */
export const supportsBlur = (): boolean => {
  return (
    device.platform('ios').gte(13) ||
    device.platform('ipados').gte(13) ||
    device.platform('android').gte(31) ||
    device.platform('macos').gte(14)
  );
};

/**
 * Checks if the current device supports Apple's Liquid Glass design language
 *
 * Liquid Glass was introduced at WWDC 2025:
 * - iOS 26+ for iPhone
 * - iPadOS 26+ for iPad
 * - macOS 26+ for Mac
 *
 * @returns True if the device supports Liquid Glass effects
 *
 * @example
 * import { supportsLiquidGlass } from '@/helper/version';
 *
 * if (supportsLiquidGlass()) {
 *   // Use SwiftUI glass variant buttons
 * } else {
 *   // Use fallback styling
 * }
 */
export const supportsLiquidGlass = (): boolean => {
  return (
    device.platform('ios').gte(26) ||
    device.platform('ipados').gte(26) ||
    device.platform('macos').gte(26)
  );
};
