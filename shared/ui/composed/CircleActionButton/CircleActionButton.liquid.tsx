import React from 'react';
import {
  Host,
  Button as SwiftUIButton,
  HStack as SwiftUIHStack,
  Image as SwiftUIImage,
} from '@expo/ui/swift-ui';
import { buttonStyle, environment, frame, glassEffect } from '@expo/ui/swift-ui/modifiers';

import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { CIRCLE_SIZE, ICON_SIZE, type CircleActionButtonProps } from './CircleActionButton.types';
import { CircleActionButtonShell } from './CircleActionButtonShell';

const CIRCLE_STYLE = { height: CIRCLE_SIZE, width: CIRCLE_SIZE };
const GLASS_BUTTON_STYLE = buttonStyle('glass');
const BUTTON_FRAME = frame({ height: CIRCLE_SIZE, width: CIRCLE_SIZE });
const LIFECYCLE_FRAME = frame({ height: CIRCLE_SIZE, width: CIRCLE_SIZE, alignment: 'center' });
const BUTTON_CONTENT_MODIFIERS = [
  frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'center' }),
];
const noopPress = () => {};

/**
 * iOS 26+ liquid-glass circle. Tap-only actions mirror the CameraScreen.tsx
 * iOS toolbar (`buttonStyle('glass')` + `glassEffect`). Held actions use the
 * same SwiftUI glass host wrapped in the shared Pressable so press-in/out
 * gestures still get the SF Symbol/liquid surface.
 */
export function CircleActionButtonLiquid(props: CircleActionButtonProps): React.ReactElement {
  const [foreground] = useThemeColor(['foreground'] as const);
  const colorScheme = useColorScheme();
  const { systemIcon, onPress, onPressIn, onPressOut, disabled = false, color } = props;
  const iconColor = color ?? foreground;
  const interactive = !disabled && !!(onPress || onPressIn || onPressOut);
  const usesPressLifecycle = !!(onPressIn || onPressOut);
  const glassEffectModifier = React.useMemo(
    () => glassEffect({ shape: 'circle', glass: { variant: 'regular', interactive } }),
    [interactive]
  );
  const buttonModifiers = React.useMemo(
    () => [
      GLASS_BUTTON_STYLE,
      environment('colorScheme', colorScheme),
      BUTTON_FRAME,
      glassEffectModifier,
    ],
    [colorScheme, glassEffectModifier]
  );
  const lifecycleModifiers = React.useMemo(
    () => [environment('colorScheme', colorScheme), LIFECYCLE_FRAME, glassEffectModifier],
    [colorScheme, glassEffectModifier]
  );

  if (usesPressLifecycle) {
    return (
      <CircleActionButtonShell {...props}>
        <Pressable
          onPress={interactive ? onPress : undefined}
          onPressIn={interactive ? onPressIn : undefined}
          onPressOut={interactive ? onPressOut : undefined}
          disabled={!interactive}
          activeOpacity={1}
          hitSlop={6}
          style={CIRCLE_STYLE}>
          <Host style={CIRCLE_STYLE} matchContents={false}>
            <SwiftUIHStack alignment="center" modifiers={lifecycleModifiers}>
              <SwiftUIImage systemName={systemIcon as never} size={ICON_SIZE} color={iconColor} />
            </SwiftUIHStack>
          </Host>
        </Pressable>
      </CircleActionButtonShell>
    );
  }

  return (
    <CircleActionButtonShell {...props}>
      <Host style={CIRCLE_STYLE} matchContents={false}>
        <SwiftUIButton modifiers={buttonModifiers} onPress={interactive ? onPress : noopPress}>
          <SwiftUIHStack alignment="center" modifiers={BUTTON_CONTENT_MODIFIERS}>
            <SwiftUIImage systemName={systemIcon as never} size={ICON_SIZE} color={iconColor} />
          </SwiftUIHStack>
        </SwiftUIButton>
      </Host>
    </CircleActionButtonShell>
  );
}
