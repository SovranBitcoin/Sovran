import { Platform } from 'react-native';

import { useSettingsStore } from '@/shared/stores/global/settingsStore';

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
 * Whether the OS can render a native blur: iOS 13+ / Android 12+ (API 31) /
 * macOS 14+.
 *
 * OS support, not what this app actually draws. `expo-blur`'s Android
 * `blurMethod` defaults to `'none'` and nothing here sets it — and since SDK
 * 56 a blur method also needs a `blurTarget` ref or it silently falls back to
 * `'none'`. So on Android a `BlurView` is a translucent tint at ANY version,
 * and the API-31 threshold buys nothing today. That is why
 * `Capabilities.frostedSurface`, the design-intent axis, is iOS-only; gate
 * frosted chrome on that, not on this.
 */
export const supportsBlur = (): boolean => {
  return (
    device.platform('ios').gte(13) ||
    device.platform('ipados').gte(13) ||
    device.platform('android').gte(31) ||
    device.platform('macos').gte(14)
  );
};

/** Build-time master switch. Flip to `false` to disable all liquid glass
 *  effects app-wide regardless of device or settings. The runtime
 *  `mockNoGlass` toggle (Settings → Developer) is the user-facing
 *  equivalent that doesn't require a rebuild. */
export const LIQUID_GLASS_ENABLED = true;

/**
 * True when the OS supports Apple Liquid Glass (iOS/iPadOS/macOS 26+,
 * WWDC 2025) AND nothing has overridden it.
 *
 * Two override layers, both must be off for glass to render:
 *   1. `LIQUID_GLASS_ENABLED` — build-time constant.
 *   2. `settings.mockNoGlass` — runtime dev toggle, persisted via Zustand.
 *      Read via `getState()` so this stays a synchronous helper usable
 *      from module scope, worklets, and outside of React.
 *
 * Surfaces that read this inside their render path will pick up the
 * toggle on next render. Module-level call sites (native tabs, etc.) are
 * captured at app boot and require a relaunch to update — same constraint
 * the build-time flag has.
 */
export const supportsLiquidGlass = (): boolean => {
  if (!LIQUID_GLASS_ENABLED) return false;
  if (useSettingsStore.getState().mockNoGlass) return false;
  return (
    device.platform('ios').gte(26) ||
    device.platform('ipados').gte(26) ||
    device.platform('macos').gte(26)
  );
};
