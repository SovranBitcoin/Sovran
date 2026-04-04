import { useState, useEffect } from 'react';

import { useCameraPermissions } from 'expo-camera';
import { Linking } from 'react-native';

import { buttonHandlerPopup, cameraPermissionPopup } from '@/shared/lib/popup';
import { log } from '@/shared/lib/logger';

export function useHandleCameraPermission() {
  const [permission, requestPermission] = useCameraPermissions();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    if (permission) setIsChecking(false);
  }, [permission]);

  const handlePermission = async (): Promise<boolean> => {
    if (!permission) {
      log.debug('camera.permission.not_ready');
      return false;
    }
    if (permission.granted) {
      log.debug('camera.permission.already_granted');
      return true;
    }

    log.info('camera.permission.requesting', { canAskAgain: permission.canAskAgain });
    if (permission.canAskAgain) {
      const res = await requestPermission();
      if (res.granted) {
        log.info('camera.permission.granted');
        cameraPermissionPopup('granted');
        return true;
      }
    }

    log.warn('camera.permission.denied', { canAskAgain: permission.canAskAgain });
    // For both denied and blocked, show error with Open Settings button
    buttonHandlerPopup({
      title: permission.canAskAgain ? 'Camera Permission Denied' : 'Camera Permission Blocked',
      description: permission.canAskAgain
        ? 'Camera access is denied. Please enable it in your device settings.'
        : 'Camera access is blocked. Please enable it in your device settings.',
      buttons: [
        {
          text: 'Open Settings',
          icon: 'mdi:cog-outline',
          variant: 'primary',
          onPress: async (close: any) => {
            close({} as any);
            await Linking.openURL('app-settings:');
          },
        },
      ],
    });
    return false;
  };

  return { permission, isChecking, handlePermission };
}
