/**
 * Android bundle entry. Flat-only, so `@expo/ui/swift-ui` never enters the
 * Android graph for the camera overlay.
 */
import { defineVariants } from '@/shared/ui/capability';

import { CameraActionButtonsFlat } from './CameraActionButtons.flat';
import type { CameraActionButtonsProps } from './CameraActionButtons.types';

export const CameraActionButtons = defineVariants<CameraActionButtonsProps>('CameraActionButtons', {
  flat: CameraActionButtonsFlat,
});
