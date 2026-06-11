/**
 * Standalone camera screen orchestration for direct navigation.
 * Keeps route files thin while reusing the shared CameraScreen UI.
 */

import React, { useEffect, useRef } from 'react';
import { Stack } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { z } from 'zod';

import { CameraScreen } from '@/features/camera';
import { cameraRouteParamsSchema } from './CameraScreen/CameraScreen';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useColadaContext } from '@sovranbitcoin/colada/react';
import { Log, log, useLifecycleLogger } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = cameraRouteParamsSchema.extend({
  action: z.enum(['nfc-pay']).optional(),
});

export function StandaloneCameraScreen() {
  // Logger name distinguishes the wrapper from the inner CameraScreen so log-doctor
  // mount sequences are unambiguous: shell mount → inner mount → inner unmount → shell unmount.
  useLifecycleLogger('StandaloneCameraShell');
  const params = useRouteParams(ParamsSchema, { where: 'camera.standalone' });
  const action = params?.action;
  const foreground = useThemeColor('foreground');
  const { machine } = useColadaContext();

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
    <Log name="StandaloneCameraScreen">
      <>
        <Stack.Screen
          options={{
            title: 'Scan QR',
            headerTransparent: true,
            headerStyle: { backgroundColor: 'transparent' },
            headerTintColor: foreground,
            headerTitleStyle: { color: foreground },
            headerLeft: () => (
              <ScreenHeaderAction
                icon="material-symbols:close-rounded"
                color={foreground}
                onPress={() => {
                  if (router.canGoBack()) {
                    router.back();
                  } else {
                    router.replace('/');
                  }
                }}
              />
            ),
          }}
        />
        <CameraScreen />
      </>
    </Log>
  );
}
