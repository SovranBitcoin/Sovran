import { useState, useEffect } from 'react';

import { useCameraPermissions } from 'expo-camera';
import { Linking } from 'react-native';

import { popup } from '@/helper/popup';

function showPermissionDeniedPopup(message: string) {
  popup({
    message,
    emoji: '🚨',
    type: 'error',
    buttons: [{ text: 'Open Settings', onPress: () => Linking.openURL('app-settings:') }],
  });
}

export function useHandleCameraPermission() {
  const [permission, requestPermission] = useCameraPermissions();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    if (permission) setIsChecking(false);
  }, [permission]);

  const handlePermission = async (): Promise<boolean> => {
    if (!permission) return false;
    if (permission.granted) return true;

    if (permission.canAskAgain) {
      const res = await requestPermission();
      if (res.granted) {
        popup({ message: 'camera_permission_granted', type: 'success' });
        return true;
      }
      showPermissionDeniedPopup('camera_permission_denied');
      return false;
    }

    showPermissionDeniedPopup('camera_permission_blocked');
    return false;
  };

  return { permission, isChecking, handlePermission };
}
