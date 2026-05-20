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
import { CIRCLE_SIZE, ICON_SIZE, type CircleActionButtonProps } from './CircleActionButton.types';
import { CircleActionButtonShell } from './CircleActionButtonShell';

/**
 * iOS 26+ liquid-glass circle. Mirrors the CameraScreen.tsx iOS toolbar
 * (`buttonStyle('glass')` + `glassEffect`). The dispatcher only routes here
 * when `systemIcon` is present — otherwise the SF Symbol is unavailable
 * and the blur fallback renders instead.
 */
export function CircleActionButtonLiquid(props: CircleActionButtonProps): React.ReactElement {
  const [foreground] = useThemeColor(['foreground'] as const);
  const colorScheme = useColorScheme();
  const { systemIcon, onPress, disabled = false, color } = props;
  const iconColor = color ?? foreground;
  const interactive = !disabled && !!onPress;

  return (
    <CircleActionButtonShell {...props}>
      <Host style={{ height: CIRCLE_SIZE, width: CIRCLE_SIZE }} matchContents={false}>
        <SwiftUIButton
          modifiers={[
            buttonStyle('glass'),
            environment('colorScheme', colorScheme),
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
    </CircleActionButtonShell>
  );
}
