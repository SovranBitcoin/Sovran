/**
 * iOS bundle entry. Uses the selector overload because liquid only renders
 * when `systemIcon` is provided — without an SF Symbol, the SwiftUI glass
 * variant has nothing to draw, so iOS-26+ without a `systemIcon` falls
 * through to the blur variant just like older iOS does.
 */
import { defineVariants } from '@/shared/ui/capability';

import { CircleActionButtonBlur } from './CircleActionButton.blur';
import { CircleActionButtonFlat } from './CircleActionButton.flat';
import { CircleActionButtonLiquid } from './CircleActionButton.liquid';
import type { CircleActionButtonProps } from './CircleActionButton.types';

export type { CircleActionButtonProps } from './CircleActionButton.types';

export const CircleActionButton = defineVariants<CircleActionButtonProps>(
  'CircleActionButton',
  (caps, props) => {
    if (caps.liquidGlass && props.systemIcon) return CircleActionButtonLiquid;
    if (caps.frostedSurface) return CircleActionButtonBlur;
    return CircleActionButtonFlat;
  }
);
