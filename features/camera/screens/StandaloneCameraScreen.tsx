/**
 * Standalone camera screen orchestration for direct navigation.
 * Keeps route files thin while reusing the shared CameraScreen UI.
 */

import React, { useEffect, useRef } from 'react';
import { TouchableOpacity } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';

import Icon from 'assets/icons';
import { CameraScreen } from '@/features/camera';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useCocoPaymentUXContext } from 'coco-payment-ux/react';

export function StandaloneCameraScreen() {
  const { unit, action } = useLocalSearchParams<{ unit: string; action: string }>();
  const foreground = useThemeColor('foreground');
  const { machine } = useCocoPaymentUXContext();

  const nfcFiredRef = useRef(false);
  const shouldAutoStartNfc = Array.isArray(action)
    ? action.includes('nfc-pay')
    : action === 'nfc-pay';

  useEffect(() => {
    if (!shouldAutoStartNfc) {
      nfcFiredRef.current = false;
      return;
    }

    if (!nfcFiredRef.current) {
      nfcFiredRef.current = true;
      void machine.scan?.(undefined, { source: 'nfc' });
    }
  }, [shouldAutoStartNfc, machine]);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Scan QR',
          headerTransparent: true,
          headerStyle: { backgroundColor: 'transparent' },
          headerTintColor: foreground,
          headerTitleStyle: { color: foreground },
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace('/');
                }
              }}
              style={{ padding: 8 }}>
              <Icon name="material-symbols:close-rounded" size={24} color={foreground} />
            </TouchableOpacity>
          ),
        }}
      />
      <CameraScreen />
    </>
  );
}
