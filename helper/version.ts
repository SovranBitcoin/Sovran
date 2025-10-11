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
 * It supports iOS, Android, Web, Windows, and macOS platforms with various
 * comparison operators (gt, gte, lt, lte, eq).
 *
 * @example
 * // Basic usage
 * device.platform('ios').gte(10) // true if iOS 10 or higher
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
   * @param platform - The target platform to check ('ios', 'android', 'web', 'windows', 'macos')
   * @returns The DeviceChecker instance for method chaining
   *
   * @example
   * device.platform('ios') // Configure to check iOS version
   * device.platform('android').gte(21) // Check if Android 5.0+
   */
  platform(platform: 'ios' | 'android' | 'web' | 'windows' | 'macos'): DeviceChecker {
    this.platformOS = platform;

    if (Platform.OS === platform) {
      if (platform === 'ios' || platform === 'android') {
        // For iOS and Android, parse the version as integer
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
export const device = new DeviceChecker();
