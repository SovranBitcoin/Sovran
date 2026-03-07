import React from 'react';
import {
  Host,
  Button as SwiftUIButton,
  HStack as SwiftUIHStack,
  Image as SwiftUIImage,
} from '@expo/ui/swift-ui';
import { buttonStyle, frame, glassEffect } from '@expo/ui/swift-ui/modifiers';

import { CameraLayout } from './CameraLayout';
import { useCameraScreen, type CameraScreenProps } from './useCameraScreen';

export function CameraScreen(props: CameraScreenProps) {
  const shared = useCameraScreen(props);
  const { handleClipboardPress, handleGalleryPress, toggleFlashlight, flashlightOn } = shared;

  const glassButtonModifiers = [
    buttonStyle('glass'),
    frame({ height: 52, width: 52 }),
    glassEffect({
      shape: 'circle',
      glass: { variant: 'regular', interactive: true },
    }),
  ];

  const centeredModifiers = [
    frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'center' }),
  ];

  return (
    <CameraLayout {...shared}>
      <Host style={{ height: 52, width: 52 }} matchContents={false}>
        <SwiftUIButton modifiers={glassButtonModifiers} onPress={handleClipboardPress}>
          <SwiftUIHStack alignment="center" modifiers={centeredModifiers}>
            <SwiftUIImage systemName="doc.on.clipboard" size={22} color="white" />
          </SwiftUIHStack>
        </SwiftUIButton>
      </Host>

      <Host style={{ height: 52, width: 52 }} matchContents={false}>
        <SwiftUIButton modifiers={glassButtonModifiers} onPress={handleGalleryPress}>
          <SwiftUIHStack alignment="center" modifiers={centeredModifiers}>
            <SwiftUIImage systemName="photo" size={22} color="white" />
          </SwiftUIHStack>
        </SwiftUIButton>
      </Host>

      <Host style={{ height: 52, width: 52 }} matchContents={false}>
        <SwiftUIButton modifiers={glassButtonModifiers} onPress={toggleFlashlight}>
          <SwiftUIHStack alignment="center" modifiers={centeredModifiers}>
            <SwiftUIImage
              systemName={flashlightOn ? 'flashlight.on.fill' : 'flashlight.off.fill'}
              size={22}
              color="white"
            />
          </SwiftUIHStack>
        </SwiftUIButton>
      </Host>
    </CameraLayout>
  );
}
