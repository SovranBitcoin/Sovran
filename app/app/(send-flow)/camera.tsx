/**
 * @fileoverview Send flow camera route.
 *
 * Part of the (send-flow) modal group — displays with a back button. The
 * screen body is shared with the other flow's camera route via
 * `FlowCameraScreen`.
 */
import { FlowCameraScreen } from '@/features/camera/screens/FlowCameraScreen';

export default function Camera() {
  return <FlowCameraScreen />;
}
