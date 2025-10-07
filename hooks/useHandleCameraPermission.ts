import { useState, useEffect } from 'react';
import { useCameraPermissions } from 'expo-camera';
import { showMessage } from '@/helper/popup';
import { Linking } from 'react-native';

export function useHandleCameraPermission() {
  const [permission, requestPermission] = useCameraPermissions();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    if (permission) {
      setIsChecking(false);
    }
  }, [permission]);

  const handlePermission = async (): Promise<boolean> => {
    if (!permission) return false;

    if (permission.granted) {
      return true;
    }

    if (permission.canAskAgain) {
      const res = await requestPermission();
      if (res.granted) {
        showMessage({ message: 'camera_permission_granted', type: 'success' });
        return true;
      }

      showMessage({
        message: 'camera_permission_denied',
        emoji: '🚨',
        type: 'error',
        buttons: [
          {
            text: 'Open Settings',
            onPress: () => {
              Linking.openURL('app-settings:');
            },
          },
        ],
      });
      return false;
    }

    showMessage({
      message: 'camera_permission_blocked',
      emoji: '🚨',
      type: 'error',
      buttons: [
        {
          text: 'Open Settings',
          onPress: () => {
            Linking.openURL('app-settings:');
          },
        },
      ],
    });
    return false;
  };

  return {
    permission,
    isChecking,
    handlePermission,
  };
}
