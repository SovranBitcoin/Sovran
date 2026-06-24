import { useCameraPermissions } from 'expo-camera';
import { Linking } from 'react-native';

import { actionMenuPopup, paramPopup } from '@/shared/lib/popup';
import { log } from '@/shared/lib/logger';

export function useHandleCameraPermission() {
  const [permission, requestPermission] = useCameraPermissions();
  // `isChecking` is just "permission not resolved yet": expo-camera returns null
  // until the permission state loads, then a PermissionResponse object. Derive it
  // rather than mirror it into state through an effect (set-state-in-effect).
  const isChecking = !permission;

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
          text: 'Open settings',
          icon: 'material-symbols:settings-rounded',
          variant: 'primary',
          onPress: async () => {
            // `app-settings:` is the iOS deep link to the app's own Settings
            // page — not in the http/https/mailto/tel allowlist enforced by
            // openExternalUrl, but safe here because the scheme is a constant.
            // eslint-disable-next-line no-restricted-syntax
            await Linking.openURL('app-settings:');
          },
        },
      ],
    });
    return false;
  };

  return { permission, isChecking, handlePermission };
}
