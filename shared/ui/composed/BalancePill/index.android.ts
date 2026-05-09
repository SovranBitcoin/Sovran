/**
 * Android bundle entry. Flat-only — keeps `@expo/ui/swift-ui` and
 * `BlurCardFrame` off the Android bundle graph.
 */
import { defineVariants } from '@/shared/ui/capability';

import BalancePillFlat from './BalancePill.flat';
import type { BalancePillProps } from './BalancePill.types';

export type { BalancePillProps } from './BalancePill.types';

const BalancePill = defineVariants<BalancePillProps>('BalancePill', {
  flat: BalancePillFlat,
});

export default BalancePill;
