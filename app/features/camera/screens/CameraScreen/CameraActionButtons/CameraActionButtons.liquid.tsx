import React from 'react';
import { View } from 'react-native';

import {
  Host,
  Button as SwiftUIButton,
  HStack as SwiftUIHStack,
  Image as SwiftUIImage,
} from '@expo/ui/swift-ui';
import { buttonStyle, frame, glassEffect } from '@expo/ui/swift-ui/modifiers';

import { CAMERA_ACTIONS, type CameraActionButtonsProps } from './CameraActionButtons.types';

const GLASS_BUTTON_SIZE = 52;
/** `Host` is a native SwiftUI container and takes no Tailwind class. */
const HOST_STYLE = { height: GLASS_BUTTON_SIZE, width: GLASS_BUTTON_SIZE } as const;

/** SF Symbol names accepted by `@expo/ui`, without pinning its symbol-set version. */
type SFSymbolName = NonNullable<React.ComponentProps<typeof SwiftUIImage>['systemName']>;

/**
 * One circular Liquid Glass control in the camera overlay's action row. The
 * three buttons differ only by SF Symbol and handler; the Host sizing, glass
 * modifiers, and centring stack must stay identical or the row's spacing
 * drifts.
 *
 * The RN wrapper carries the accessible name, role, state and testID (the
 * SwiftUI button exposes none of them to the JS tree); VoiceOver activation
 * reaches the handler through `onAccessibilityTap`.
 */
function GlassCircleButton({
  systemName,
  onPress,
  testID,
  accessibilityLabel,
  selected,
}: {
  systemName: SFSymbolName;
  onPress: () => void | Promise<void>;
  testID: string;
  accessibilityLabel: string;
  selected?: boolean;
}) {
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={selected === undefined ? undefined : { selected }}
      onAccessibilityTap={() => void onPress()}>
      <Host style={HOST_STYLE} matchContents={false}>
        <SwiftUIButton
          modifiers={[
            buttonStyle('glass'),
            frame({ height: GLASS_BUTTON_SIZE, width: GLASS_BUTTON_SIZE }),
            glassEffect({ shape: 'circle', glass: { variant: 'regular', interactive: true } }),
          ]}
          onPress={() => void onPress()}>
          <SwiftUIHStack
            alignment="center"
            modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'center' })]}>
            <SwiftUIImage systemName={systemName} size={22} color="white" />
          </SwiftUIHStack>
        </SwiftUIButton>
      </Host>
    </View>
  );
}

/** SwiftUI Liquid Glass circles, used when the device supports liquid glass. */
export function CameraActionButtonsLiquid({
  onPaste,
  onGallery,
  onToggleFlashlight,
  flashlightOn,
}: CameraActionButtonsProps): React.ReactElement {
  return (
    <>
      <GlassCircleButton
        systemName="doc.on.clipboard"
        onPress={onPaste}
        testID={CAMERA_ACTIONS.paste.testID}
        accessibilityLabel={CAMERA_ACTIONS.paste.label}
      />
      {onGallery ? (
        <GlassCircleButton
          systemName="photo"
          onPress={onGallery}
          testID={CAMERA_ACTIONS.gallery.testID}
          accessibilityLabel={CAMERA_ACTIONS.gallery.label}
        />
      ) : null}
      <GlassCircleButton
        systemName={flashlightOn ? 'flashlight.on.fill' : 'flashlight.off.fill'}
        onPress={onToggleFlashlight}
        testID={CAMERA_ACTIONS.flashlight.testID}
        accessibilityLabel={CAMERA_ACTIONS.flashlight.label}
        selected={!!flashlightOn}
      />
    </>
  );
}
