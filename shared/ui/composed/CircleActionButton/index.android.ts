/**
 * Android bundle entry. Flat-only — keeps `@expo/ui/swift-ui` and
 * `expo-blur` (used by the View blur primitive in the blur variant) off
 * the Android bundle graph for this component. Note that `View blur` is
 * still imported elsewhere on Android (toasts, stories) — the goal here
 * is to not pull SwiftUI in for a component that doesn't need it.
 */
import { defineVariants } from '@/shared/ui/capability';

import { CircleActionButtonFlat } from './CircleActionButton.flat';
import type { CircleActionButtonProps } from './CircleActionButton.types';

export type { CircleActionButtonProps } from './CircleActionButton.types';

export const CircleActionButton = defineVariants<CircleActionButtonProps>(
  'CircleActionButton',
  {
    flat: CircleActionButtonFlat,
  }
);
