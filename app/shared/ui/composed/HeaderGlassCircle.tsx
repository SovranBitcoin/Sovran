/**
 * @fileoverview Non-iOS entry for the liquid-glass header circle.
 *
 * The real implementation lives in `HeaderGlassCircle.ios.tsx`, so
 * `@expo/ui/swift-ui` stays off the Android bundle. Every caller gates on
 * `supportsLiquidGlass()`, which never holds off iOS; this keeps the module
 * resolvable (Android, Jest) and renders the children in a plain circle-sized
 * control with the same identity props.
 */
import React from 'react';

import { headerButtonSize } from '@/shared/styles/tokens';
import { Pressable } from '@/shared/ui/primitives/Pressable';

export function HeaderGlassCircle({
  onPress,
  disabled = false,
  children,
  testID,
  accessibilityLabel,
}: {
  onPress?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  testID?: string;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      className={
        disabled ? 'items-center justify-center opacity-40' : 'items-center justify-center'
      }
      style={BOX_SIZE}
      testID={testID}
      onPress={onPress}
      disabled={disabled || !onPress}
      accessible={!!accessibilityLabel}
      accessibilityRole={onPress ? 'button' : accessibilityLabel ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={onPress ? { disabled } : undefined}>
      {children}
    </Pressable>
  );
}

/** The size is a platform token, so it cannot be a class. */
const BOX_SIZE = { height: headerButtonSize, width: headerButtonSize };
