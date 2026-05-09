import { useState, useEffect } from 'react';

import { useCameraPermissions } from 'expo-camera';
import { Linking } from 'react-native';

import { actionMenuPopup, paramPopup } from '@/shared/lib/popup';
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
        paramPopup('camera-permission', 'granted');
        return true;
      }
    }

    log.warn('camera.permission.denied', { canAskAgain: permission.canAskAgain });
    // For both denied and blocked, surface the Open Settings action.
    actionMenuPopup({
      title: permission.canAskAgain ? 'Camera Permission Denied' : 'Camera Permission Blocked',
      buttons: [
        {
          text: 'Open Settings',
          icon: 'material-symbols:settings-rounded',
          variant: 'primary',
          onPress: async () => {
            await Linking.openURL('app-settings:');
          },
        },
      ],
    });
    return false;
  };

  return { permission, isChecking, handlePermission };
}
