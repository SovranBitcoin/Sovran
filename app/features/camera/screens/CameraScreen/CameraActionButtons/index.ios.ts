/**
 * iOS bundle entry. Liquid glass → SwiftUI glass circles; older iOS → the
 * blurred flat buttons. Android imports a separate index that omits the
 * liquid variant, keeping `@expo/ui/swift-ui` off the Android graph.
 */
import { defineVariants } from '@/shared/ui/capability';

import { CameraActionButtonsFlat } from './CameraActionButtons.flat';
import { CameraActionButtonsLiquid } from './CameraActionButtons.liquid';
import type { CameraActionButtonsProps } from './CameraActionButtons.types';

export const CameraActionButtons = defineVariants<CameraActionButtonsProps>('CameraActionButtons', {
  liquid: CameraActionButtonsLiquid,
  blur: CameraActionButtonsFlat,
  flat: CameraActionButtonsFlat,
});
