import { defineVariants } from '@/shared/ui/capability';

import { CircleActionButtonFlat } from './CircleActionButton.flat';
import type { CircleActionButtonProps } from './CircleActionButton.types';

export const CircleActionButton = defineVariants<CircleActionButtonProps>('CircleActionButton', {
  flat: CircleActionButtonFlat,
});
