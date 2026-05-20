/**
 * @fileoverview Pure capability detection.
 *
 * Takes the `mockNoGlass` settings value as input so the React provider can
 * subscribe via `useSettingsStore(s => s.mockNoGlass)` and re-render on
 * toggle. Module-scope callers (`navigation/nativeTabs.tsx`) keep using the
 * synchronous helpers in `shared/lib/version.ts` — they capture at boot and
 * accept the relaunch-on-toggle constraint.
 */

import { Platform } from 'react-native';

import { LIQUID_GLASS_ENABLED, supportsBlur } from '@/shared/lib/version';

import type { Capabilities } from './types';

interface DetectInput {
  /** Dev-toggle override from `useSettingsStore.mockNoGlass`. When true, force `liquidGlass = false`. */
  mockNoGlass: boolean;
}

const isIOS = Platform.OS === 'ios';
const isMacOS = Platform.OS === 'macos';

const osMajorVersion = (): number => {
  const v = Platform.Version;
  return typeof v === 'number' ? v : parseInt(v as string, 10) || 0;
};

const supportsLiquidGlassRaw = (): boolean => {
  if (!LIQUID_GLASS_ENABLED) return false;
  if (!(isIOS || isMacOS)) return false;
  return osMajorVersion() >= 26;
};

export function detectCapabilities({ mockNoGlass }: DetectInput): Capabilities {
  const blur = supportsBlur();
  const liquidGlass = !mockNoGlass && supportsLiquidGlassRaw();
  return {
    liquidGlass,
    blur,
    frostedSurface: isIOS && blur,
    linearGradient: true,
    meshGradient: true,
    icon: isIOS ? 'sf-symbol' : 'monicon',
  };
}
