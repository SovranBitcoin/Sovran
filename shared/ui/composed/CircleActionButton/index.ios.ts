/**
 * iOS bundle entry. Uses the selector overload because liquid only renders
 * when `systemIcon` is provided. Anything without native liquid glass uses
 * the same flat chrome as Android.
 */
import { defineVariants } from '@/shared/ui/capability';

import { CircleActionButtonFlat } from './CircleActionButton.flat';
import { CircleActionButtonLiquid } from './CircleActionButton.liquid';
import type { CircleActionButtonProps } from './CircleActionButton.types';

export const CircleActionButton = defineVariants<CircleActionButtonProps>(
  'CircleActionButton',
  (caps, props) => {
    if (caps.liquidGlass && props.systemIcon) {
      return CircleActionButtonLiquid;
    }
    return CircleActionButtonFlat;
  }
);
