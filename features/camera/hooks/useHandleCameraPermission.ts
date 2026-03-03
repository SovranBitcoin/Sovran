import { useState, useEffect } from 'react';

import { useCameraPermissions } from 'expo-camera';
import { Linking } from 'react-native';

import { popup, cameraPermissionPopup } from '@/shared/lib/popup';

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
        cameraPermissionPopup('granted');
        return true;
      }
    }

    // For both denied and blocked, show error with Open Settings button
    popup({
      message: permission.canAskAgain ? 'Camera Permission Denied' : 'Camera Permission Blocked',
      text: permission.canAskAgain
        ? 'Camera access is denied. Please enable it in your device settings.'
        : 'Camera access is blocked. Please enable it in your device settings.',
      emoji: '🚨',
      type: 'error',
      buttons: [{ text: 'Open Settings', onPress: () => Linking.openURL('app-settings:') }],
    });
    return false;
  };

  return { permission, isChecking, handlePermission };
}
