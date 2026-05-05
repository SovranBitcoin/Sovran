/**
 * @fileoverview `CircleActionButton` — 52×52 glass-circle action affordance
 * with an optional label underneath.
 *
 * Visual parity with the `CameraScreen` toolbar (clipboard / gallery /
 * flashlight). iOS 26+ uses SwiftUI `buttonStyle('glass')` + `glassEffect`
 * just like `CameraScreen.tsx`. Older iOS and Android fall back to the
 * shared `View blur` primitive so the material looks consistent across
 * the app (same blur tint, same radius).
 *
 * Label is optional. Omit it to render an icon-only circle, matching the
 * camera toolbar. Pass a string to show a 12pt muted caption below, which
 * is how the wallet home secondary row uses it ("Split Bill" / "Soon").
 *
 * Disabled renders at 0.4 opacity with no press feedback — used for the
 * "Soon" placeholders. `interactive: false` is also passed to the SwiftUI
 * glass modifier so the tap highlight doesn't animate.
 */

import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import {
  Host,
  Button as SwiftUIButton,
  HStack as SwiftUIHStack,
  Image as SwiftUIImage,
} from '@expo/ui/swift-ui';
import { buttonStyle, frame, glassEffect } from '@expo/ui/swift-ui/modifiers';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { Log } from '@/shared/lib/logger';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { supportsLiquidGlass } from '@/shared/lib/version';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

interface CircleActionButtonProps {
  /** Monicon name used on Android and the pre-liquid-glass iOS fallback. */
  icon: string;
  /** SF Symbol name for the SwiftUI glass path (iOS 26+). If omitted on
   *  iOS, the `icon` monicon is rendered inside the blur fallback instead. */
  systemIcon?: string;
  /** Optional caption under the circle. Omit for icon-only (e.g. camera toolbar). */
  label?: string;
  onPress?: () => void;
  disabled?: boolean;
  /** Override for the icon tint. Defaults to `foreground`. */
  color?: string;
  testID?: string;
  /** VoiceOver/TalkBack label. Defaults to `label`; required for icon-only
   *  buttons (no `label`) since the glyph carries no name. */
  accessibilityLabel?: string;
  /** Optional VoiceOver hint describing the action's outcome. */
  accessibilityHint?: string;
}

const CIRCLE_SIZE = 52;
const ICON_SIZE = 22;

export function CircleActionButton({
  icon,
  systemIcon,
  label,
  onPress,
  disabled = false,
  color,
  testID,
  accessibilityLabel,
  accessibilityHint,
}: CircleActionButtonProps): React.ReactElement {
  const [foreground] = useThemeColor(['foreground'] as const);
  const iconColor = color ?? foreground;
  const interactive = !disabled && !!onPress;
  const a11yLabel = accessibilityLabel ?? label;
  const a11yState = { disabled: !interactive };

  // iOS 26+ with a matching SF Symbol → native glass material. Mirrors
  // the CameraScreen.tsx iOS toolbar (buttonStyle('glass') + glassEffect).
  const useNativeGlass = Platform.OS === 'ios' && supportsLiquidGlass() && !!systemIcon;

  const circle = useNativeGlass ? (
    <Host style={{ height: CIRCLE_SIZE, width: CIRCLE_SIZE }} matchContents={false}>
      <SwiftUIButton
        modifiers={[
          buttonStyle('glass'),
          frame({ height: CIRCLE_SIZE, width: CIRCLE_SIZE }),
          glassEffect({ shape: 'circle', glass: { variant: 'regular', interactive } }),
        ]}
        onPress={interactive ? onPress : () => {}}>
        <SwiftUIHStack
          alignment="center"
          modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'center' })]}>
          <SwiftUIImage systemName={systemIcon as any} size={ICON_SIZE} color={iconColor} />
        </SwiftUIHStack>
      </SwiftUIButton>
    </Host>
  ) : (
    <Pressable
      onPress={interactive ? onPress : undefined}
      disabled={!interactive}
      style={({ pressed }) => [
        styles.blurPressable,
        pressed && interactive ? { opacity: 0.8 } : null,
      ]}
      hitSlop={6}>
      <View
        blur
        blurIntensity={60}
        blurTint="prominent"
        style={[
          styles.blurCircle,
          {
            width: CIRCLE_SIZE,
            height: CIRCLE_SIZE,
            borderRadius: CIRCLE_SIZE / 2,
          },
        ]}>
        <Icon name={icon} size={ICON_SIZE} color={iconColor} />
      </View>
    </Pressable>
  );

  return (
    <Log name="CircleActionButton">
      <View
        testID={testID}
        pointerEvents={interactive ? 'auto' : 'none'}
        accessible
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={a11yState}
        style={[styles.wrapper, { opacity: disabled ? 0.4 : 1 }]}>
        {circle}
        {label ? (
          <Text
            size={12}
            weight="medium"
            style={[styles.label, { color: opacity(foreground, 0.7) }]}>
            {label}
          </Text>
        ) : null}
      </View>
    </Log>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  blurPressable: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  blurCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  label: {
    textAlign: 'center',
    marginTop: 6,
  },
});
