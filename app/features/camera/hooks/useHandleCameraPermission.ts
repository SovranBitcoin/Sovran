import { useEffect, useRef, useState } from 'react';
import { useCameraPermissions, type PermissionResponse } from 'expo-camera';

import { paramPopup } from '@/shared/lib/popup';
import { log } from '@/shared/lib/logger';

export function useHandleCameraPermission() {
  const [permission, requestPermission] = useCameraPermissions();

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

  return { permission, handlePermission };
}

export type CameraPermissionView = 'starting' | 'camera' | 'required';

/** Black until the permission is known and the one ask on open has settled:
 *  the hook starts at `null` on every mount, so `!granted` flashed "required". */
export function cameraPermissionView(
  permission: Pick<PermissionResponse, 'granted'> | null,
  askSettled: boolean
): CameraPermissionView {
  if (permission?.granted) return 'camera';
  if (!permission || !askSettled) return 'starting';
  return 'required';
}

/** Callers open the camera at once; the screen asks once when it opens. */
export function useCameraPermissionGate() {
  const { permission, handlePermission } = useHandleCameraPermission();
  const asked = useRef(false);
  const [askSettled, setAskSettled] = useState(false);

  useEffect(() => {
    if (!permission || permission.granted || asked.current) return;
    asked.current = true;
    void handlePermission().finally(() => setAskSettled(true));
  }, [permission, handlePermission]);

  return {
    view: cameraPermissionView(permission, askSettled),
    requestPermission: () => void handlePermission(),
  };
}
