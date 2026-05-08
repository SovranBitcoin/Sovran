import React from 'react';
import {
  Host,
  Button as SwiftUIButton,
  HStack as SwiftUIHStack,
  Image as SwiftUIImage,
  Text as SwiftUIText,
} from '@expo/ui/swift-ui';
import { buttonStyle, font, foregroundStyle, frame, padding } from '@expo/ui/swift-ui/modifiers';

import { Log } from '@/shared/lib/logger';
import type { CapsuleButtonProps } from './CapsuleButton.fallback';

const DEFAULT_HEIGHT = 48;

// Note on testID: SwiftUI Buttons inside a Host don't accept a React testID
// prop, and a wrapper RN View with pointerEvents="box-none" can leak touches
// to siblings instead of routing them through the SwiftUI Button. The clean
// path is to set the testID on the EXISTING parent View at the call site
// (e.g. the `<View className="flex-1">` wrapper around it at the call site).
// That parent View already routes touches correctly through to the Host.
// We accept and ignore the testID prop here so the type stays uniform with
// the iOS / Android variants.
export function CapsuleButtonLiquid({
  label,
  systemIcon,
  color = '#FFFFFF',
  onPress,
  height = DEFAULT_HEIGHT,
}: CapsuleButtonProps): React.ReactElement {
  return (
    <Log name="CapsuleButton">
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
    </Log>
  );
}
