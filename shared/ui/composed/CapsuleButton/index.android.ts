/**
 * Android bundle entry. Imports only `flat` — Android stays visually flat
 * by design (`frostedSurface = false` on Android). Skipping the blur and
 * liquid variants keeps `@expo/ui/swift-ui` and `BlurCardFrame` off the
 * Android bundle graph.
 */
import { defineVariants } from '@/shared/ui/capability';

import { CapsuleButtonFlat } from './CapsuleButton.flat';
import type { CapsuleButtonProps } from './CapsuleButton.types';

export const CapsuleButton = defineVariants<CapsuleButtonProps>('CapsuleButton', {
  flat: CapsuleButtonFlat,
});
