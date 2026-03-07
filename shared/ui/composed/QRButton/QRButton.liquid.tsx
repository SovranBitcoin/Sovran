import React from 'react';
import {
  Host,
  Button as SwiftUIButton,
  HStack as SwiftUIHStack,
  Image as SwiftUIImage,
} from '@expo/ui/swift-ui';
import { buttonStyle, frame, glassEffect } from '@expo/ui/swift-ui/modifiers';

import type { QRButtonProps } from './QRButton';

const DEFAULT_SIZE = 72;

export function QRButtonLiquid({
  onPress,
  accentColor,
  color,
  size = DEFAULT_SIZE,
}: QRButtonProps): React.ReactElement {
  return (
    <Host style={{ height: size, width: size }} matchContents={false}>
      <SwiftUIButton
        modifiers={[
          buttonStyle('glass'),
          frame({ height: size, width: size }),
          glassEffect({
            shape: 'circle',
            glass: { tint: accentColor, variant: 'regular', interactive: true },
          }),
        ]}
        onPress={onPress}>
        <SwiftUIHStack
          alignment="center"
          modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'center' })]}>
          <SwiftUIImage systemName="qrcode.viewfinder" size={22} color={color} />
        </SwiftUIHStack>
      </SwiftUIButton>
    </Host>
  );
}
