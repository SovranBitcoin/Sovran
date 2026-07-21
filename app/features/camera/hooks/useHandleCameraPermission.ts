import { useState, useEffect } from 'react';

import { useCameraPermissions } from 'expo-camera';

import { paramPopup } from '@/shared/lib/popup';
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
    // Denied/blocked feedback goes through the HeroUI toast popup (with its
    // Open-settings action), NOT actionMenuPopup: the heroui action menu
    // renders in the app window (its Menu.Portal must disable
    // FullWindowOverlay — see ActionMenuHost), so above a pushed native
    // screen like /camera it presents invisibly BEHIND the route and the
    // user gets a silent dead-end. The toast lives in a FullWindowOverlay
    // and is visible from every route.
    paramPopup('camera-permission', permission.canAskAgain ? 'denied' : 'blocked');
    return false;
  };

  return { permission, isChecking, handlePermission };
}
