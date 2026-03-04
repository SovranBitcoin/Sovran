import { useState, useEffect } from 'react';

import { useCameraPermissions } from 'expo-camera';
import { Linking } from 'react-native';

import { buttonHandlerPopup, cameraPermissionPopup } from '@/shared/lib/popup';

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
