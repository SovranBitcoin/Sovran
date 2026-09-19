import React from 'react';

import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Button } from '@/shared/ui/primitives/Button';

import { CAMERA_ACTIONS, type CameraActionButtonsProps } from './CameraActionButtons.types';

/** Blurred icon buttons: Android, and iOS without native liquid glass. */
export function CameraActionButtonsFlat({
  onPaste,
  onGallery,
  onToggleFlashlight,
  flashlightOn,
}: CameraActionButtonsProps): React.ReactElement {
  const foreground = useThemeColor('foreground');
  const flashlightLabel = flashlightOn
    ? CAMERA_ACTIONS.flashlight.labelOn
    : CAMERA_ACTIONS.flashlight.labelOff;
  return (
    <>
      <Button
        testID={CAMERA_ACTIONS.paste.testID}
        accessibilityLabel={CAMERA_ACTIONS.paste.label}
        onPress={onPaste}
        icon={<Icon name="lets-icons:copy" color={foreground} />}
        blur
      />
      {onGallery ? (
        <Button
          testID={CAMERA_ACTIONS.gallery.testID}
          accessibilityLabel={CAMERA_ACTIONS.gallery.label}
          onPress={onGallery}
          icon={<Icon name="proicons:photo" color={foreground} />}
          blur
        />
      ) : null}
      <Button
        testID={CAMERA_ACTIONS.flashlight.testID}
        accessibilityLabel={flashlightLabel}
        onPress={onToggleFlashlight}
        icon={
          flashlightOn ? (
            <Icon name="mdi:lightbulb-on" color={foreground} />
          ) : (
            <Icon name="mdi:lightbulb-on-outline" color={foreground} />
          )
        }
        blur
      />
    </>
  );
}
