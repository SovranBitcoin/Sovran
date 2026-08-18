/**
 * Standalone camera screen orchestration for direct navigation.
 * Keeps route files thin while reusing the shared CameraScreen UI.
 */

import { useEffect, useRef } from 'react';
import { Stack } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { z } from 'zod';

import { CameraScreen } from '@/features/camera';
import { cameraRouteParamsSchema } from './CameraScreen/CameraScreen';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { withGlassHeaderItems } from '@/navigation/headerItems';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useColadaContext } from 'wallet/react';
import { Log, log, useLifecycleLogger } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = cameraRouteParamsSchema.extend({
  /**
   * `nfc-pay` auto-starts an NFC payment scan; `signer-pair` (the signer
   * hub's "Scan QR Code" / `/camera?action=signer-pair` link) restricts the
   * scanner to NIP-46 pairing URIs — no payment fallback.
   */
  action: z.enum(['nfc-pay', 'signer-pair']).optional(),
});

export function StandaloneCameraScreen() {
  // Logger name distinguishes the wrapper from the inner CameraScreen so log-doctor
  // mount sequences are unambiguous: shell mount → inner mount → inner unmount → shell unmount.
  useLifecycleLogger('StandaloneCameraShell');
  const params = useRouteParams(ParamsSchema, { where: 'camera.standalone' });
  const action = params?.action;
  const isSignerPair = action === 'signer-pair';
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
          options={withGlassHeaderItems({
            title: isSignerPair ? 'Connect App' : 'Scan QR',
            headerTransparent: true,
            headerStyle: { backgroundColor: 'transparent' },
            headerTintColor: foreground,
            headerTitleStyle: { color: foreground },
            headerLeft: () => (
              <ScreenHeaderAction
                icon="material-symbols:close-rounded"
                onPress={() => {
                  if (router.canGoBack()) {
                    router.back();
                  } else {
                    router.replace('/');
                  }
                }}
              />
            ),
          })}
        />
        <CameraScreen signerPairOnly={isSignerPair} />
      </>
    </Log>
  );
}
