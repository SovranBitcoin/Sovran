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

/**
 * React hook variant of `supportsLiquidGlass`. Use this inside components
 * when you want the surface to flip the moment the user toggles the
 * `mockNoGlass` switch (no navigation away/back required).
 */
export function useSupportsLiquidGlass(): boolean {
  const mockNoGlass = useSettingsStore((s) => s.mockNoGlass);
  if (!LIQUID_GLASS_ENABLED || mockNoGlass) return false;
  return (
    device.platform('ios').gte(26) ||
    device.platform('ipados').gte(26) ||
    device.platform('macos').gte(26)
  );
}

/**
 * Conditionally include SwiftUI glass modifiers when liquid glass is
 * enabled. Returns `[]` if either the build-time flag or the runtime
 * `mockNoGlass` toggle is set, so callers spreading the result get
 * an empty modifier list and the SwiftUI view falls back to its
 * default appearance.
 */
export function liquidGlassModifiers<T>(...modifiers: T[]): T[] {
  if (!LIQUID_GLASS_ENABLED) return [];
  if (useSettingsStore.getState().mockNoGlass) return [];
  return modifiers;
}
