import * as React from 'react';
import { Platform } from 'react-native';
import { requireNativeModule, requireNativeView } from 'expo';
import type { LiquidGlassMenuProps, LiquidGlassMenuNativeModule } from './LiquidGlassMenu.types';

const NativeModule: LiquidGlassMenuNativeModule | null =
  Platform.OS === 'ios'
    ? requireNativeModule<LiquidGlassMenuNativeModule>('LiquidGlassMenu')
    : null;

const NativeView =
  Platform.OS === 'ios' ? requireNativeView<LiquidGlassMenuProps>('LiquidGlassMenu') : null;

const iosMajor = Platform.OS === 'ios' ? parseInt(String(Platform.Version), 10) : 0;

/**
 * True only where the native glass UIButton + UIMenu morph is available
 * (iOS 26 with the UIGlassEffect runtime symbol present). Callers should gate
 * on this and fall back to a scroll-correct GlassView menu otherwise.
 */
export const isSupported: boolean =
  Platform.OS === 'ios' && iosMajor >= 26 && Boolean(NativeModule?.isSupported);

export function LiquidGlassMenu(props: LiquidGlassMenuProps): React.ReactElement | null {
  if (!isSupported || !NativeView) {
    return null;
  }
  return <NativeView {...props} />;
}

LiquidGlassMenu.isSupported = isSupported;
