/**
 * iOS bundle entry. Imports all three variants — the capability dispatcher
 * picks one per render based on `liquidGlass` / `frostedSurface`. Lives in
 * `index.ios.ts` so Metro doesn't pull `@expo/ui/swift-ui` (only used by the
 * liquid variant) into the Android bundle.
 */
import { defineVariants } from '@/shared/ui/capability';

import { CapsuleButtonBlur } from './CapsuleButton.blur';
import { CapsuleButtonFlat } from './CapsuleButton.flat';
import { CapsuleButtonLiquid } from './CapsuleButton.liquid';
import type { CapsuleButtonProps } from './CapsuleButton.types';

export type { CapsuleButtonProps } from './CapsuleButton.types';

export const CapsuleButton = defineVariants<CapsuleButtonProps>('CapsuleButton', {
  liquid: CapsuleButtonLiquid,
  blur: CapsuleButtonBlur,
  flat: CapsuleButtonFlat,
});
