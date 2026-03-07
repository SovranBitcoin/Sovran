import React from 'react';
import {
  Host,
  Button as SwiftUIButton,
  HStack as SwiftUIHStack,
  Image as SwiftUIImage,
  Text as SwiftUIText,
} from '@expo/ui/swift-ui';
import { buttonStyle, font, foregroundStyle, frame, padding } from '@expo/ui/swift-ui/modifiers';

import type { CapsuleButtonProps } from './CapsuleButton';

const DEFAULT_HEIGHT = 48;

export function CapsuleButtonLiquid({
  label,
  systemIcon,
  color = '#FFFFFF',
  onPress,
  height = DEFAULT_HEIGHT,
}: CapsuleButtonProps): React.ReactElement {
  return (
    <Host style={{ height, width: '100%' }} matchContents={false}>
      <SwiftUIButton
        modifiers={[
          buttonStyle('glass'),
          frame({ height, maxWidth: Infinity, alignment: 'center' }),
        ]}
        onPress={onPress}>
        <SwiftUIHStack
          alignment="center"
          spacing={8}
          modifiers={[frame({ maxWidth: Infinity, alignment: 'center' })]}>
          {systemIcon && <SwiftUIImage systemName={systemIcon as any} size={18} color={color} />}
          <SwiftUIText
            modifiers={[
              font({ size: 14, weight: 'bold' }),
              foregroundStyle(color),
              padding({ vertical: 8 }),
            ]}>
            {label}
          </SwiftUIText>
        </SwiftUIHStack>
      </SwiftUIButton>
    </Host>
  );
}
