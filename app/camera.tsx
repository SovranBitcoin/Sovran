/**
 * @fileoverview Standalone camera route
 *
 * Thin route wrapper. Screen orchestration lives in components/screens.
 */

import { StandaloneCameraScreen } from '@/features/camera';

export default function CameraRoute() {
  return <StandaloneCameraScreen />;
}
