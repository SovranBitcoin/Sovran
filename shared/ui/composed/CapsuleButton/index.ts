import { defineVariants } from '@/shared/ui/capability';

import { CapsuleButtonFlat } from './CapsuleButton.flat';
import type { CapsuleButtonProps } from './CapsuleButton.types';

export const CapsuleButton = defineVariants<CapsuleButtonProps>('CapsuleButton', {
  flat: CapsuleButtonFlat,
});
