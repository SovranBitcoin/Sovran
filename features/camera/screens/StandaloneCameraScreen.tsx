/**
 * Standalone camera screen orchestration for direct navigation.
 * Keeps route files thin while reusing the shared CameraScreen UI.
 */

import React, { useEffect, useRef } from 'react';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { router, Stack } from 'expo-router';
import { z } from 'zod';

import Icon from 'assets/icons';
import { CameraScreen } from '@/features/camera';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useCocoPaymentUXContext } from 'coco-payment-ux/react';
import { Screen, log, useLifecycleLogger } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  unit: z.string().max(16).optional(),
  action: z.enum(['nfc-pay']).optional(),
});

export function StandaloneCameraScreen() {
  useLifecycleLogger('StandaloneCameraScreen');
  const params = useRouteParams(ParamsSchema, { where: 'camera.standalone' });
  const action = params?.action;
  const foreground = useThemeColor('foreground');
  const { machine } = useCocoPaymentUXContext();

  const nfcFiredRef = useRef(false);
  const shouldAutoStartNfc = action === 'nfc-pay';

  useEffect(() => {
    if (!shouldAutoStartNfc) {
      nfcFiredRef.current = false;
      return;
    }

    if (!nfcFiredRef.current) {
      nfcFiredRef.current = true;
      log.info('camera.nfc.auto_start');
      void machine.scan?.(undefined, { source: 'nfc' });
    }
  }, [shouldAutoStartNfc, machine]);

  return (
    <Screen name="StandaloneCameraScreen">
      <>
        <Stack.Screen
          options={{
            title: 'Scan QR',
            headerTransparent: true,
            headerStyle: { backgroundColor: 'transparent' },
            headerTintColor: foreground,
            headerTitleStyle: { color: foreground },
            headerLeft: () => (
              <Pressable
                onPress={() => {
                  if (router.canGoBack()) {
                    router.back();
                  } else {
                    router.replace('/');
                  }
                }}
                style={{ padding: 8 }}>
                <Icon name="material-symbols:close-rounded" size={24} color={foreground} />
              </Pressable>
            ),
          }}
        />
        <CameraScreen />
      </>
    </Screen>
  );
}
