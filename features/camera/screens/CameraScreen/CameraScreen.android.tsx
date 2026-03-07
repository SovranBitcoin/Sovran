import React from 'react';
import Icon from 'assets/icons';
import { Button } from '@/shared/ui/primitives/Button';
import { CameraLayout } from './CameraLayout';
import { useCameraScreen, type CameraScreenProps } from './useCameraScreen';

export function CameraScreen(props: CameraScreenProps) {
  const shared = useCameraScreen(props);
  const { foreground, handleClipboardPress, handleGalleryPress, toggleFlashlight, flashlightOn } =
    shared;

  return (
    <CameraLayout {...shared}>
      <Button
        onPress={handleClipboardPress}
        icon={<Icon name="lets-icons:copy" color={foreground} />}
        blur
      />
      <Button
        onPress={handleGalleryPress}
        icon={<Icon name="proicons:photo" color={foreground} />}
        blur
      />
      <Button
        onPress={toggleFlashlight}
        icon={
          !flashlightOn ? (
            <Icon name="mdi:lightbulb-on-outline" color={foreground} />
          ) : (
            <Icon name="mdi:lightbulb-on" color={foreground} />
          )
        }
        blur
      />
    </CameraLayout>
  );
}
