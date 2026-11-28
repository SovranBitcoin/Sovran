/**
 * @fileoverview Camera screen for the receive modal group.
 *
 * `(receive-flow)/camera` renders exactly this — a transparent-header
 * "Scan QR" screen over `CameraScreen`, which drives `machine.scan` directly.
 */
import { Stack } from 'expo-router';

import { CameraScreen } from './CameraScreen';

const FLOW_CAMERA_OPTIONS = {
  title: 'Scan QR',
  headerTransparent: true,
  headerStyle: { backgroundColor: 'transparent' },
} as const;

export function FlowCameraScreen() {
  return (
    <>
      <Stack.Screen options={FLOW_CAMERA_OPTIONS} />
      <CameraScreen />
    </>
  );
}
