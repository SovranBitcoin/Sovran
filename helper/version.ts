import { Platform } from 'react-native';

type SupportedPlatform = 'ios' | 'ipados' | 'android' | 'web' | 'windows' | 'macos';

/**
 * Fluent API for platform version checking.
 *
 * Note on mutability: this class stores the result of the last `.platform()` call.
 * It's safe for the module-level singleton because all usages are synchronous
 * single-chain calls like `device.platform('ios').gte(13)`.
 */
class DeviceChecker {
  private isMatch = false;
  private version: number | null = null;

  /**
   * 'ios' matches both iPhone and iPad. 'ipados' matches iPad only.
   */
  platform(target: SupportedPlatform): DeviceChecker {
    const isTargetPlatform =
      target === 'ipados' ? Platform.OS === 'ios' && Platform.isPad : Platform.OS === target;

    if (isTargetPlatform) {
      this.isMatch = true;
      this.version =
        target === 'ios' || target === 'ipados' || target === 'android'
          ? parseInt(Platform.Version as string, 10)
          : parseFloat(Platform.Version as string);
    } else {
      this.isMatch = false;
      this.version = null;
    }

    return this;
  }

  gt = (v: number): boolean => this.isMatch && this.version !== null && this.version > v;
  gte = (v: number): boolean => this.isMatch && this.version !== null && this.version >= v;
  lt = (v: number): boolean => this.isMatch && this.version !== null && this.version < v;
  lte = (v: number): boolean => this.isMatch && this.version !== null && this.version <= v;
  eq = (v: number): boolean => this.isMatch && this.version !== null && this.version === v;
}

const device = new DeviceChecker();

/**
 * Blur effects need iOS 13+ / Android 12+ (API 31) / macOS 14+
 * for consistent vibrancy and native blur support.
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
 * Apple Liquid Glass: iOS 26+ / iPadOS 26+ / macOS 26+ (WWDC 2025).
 */
export const supportsLiquidGlass = (): boolean => {
  return (
    device.platform('ios').gte(26) ||
    device.platform('ipados').gte(26) ||
    device.platform('macos').gte(26)
  );
};
