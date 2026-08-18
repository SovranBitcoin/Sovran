/**
 * @fileoverview Camera screen for the send/receive modal groups.
 *
 * Both `(send-flow)/camera` and `(receive-flow)/camera` render exactly this —
 * a transparent-header "Scan QR" screen over `CameraScreen`, which drives
 * `machine.scan` directly. The two route files exist because expo-router keys
 * screens by path; the body lives here so their header options and title
 * cannot drift apart.
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
