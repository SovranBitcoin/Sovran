/**
 * iOS bundle entry. Imports all three variants — the capability dispatcher
 * picks one per render based on `liquidGlass` / `frostedSurface`.
 */
import { defineVariants } from '@/shared/ui/capability';

import BalancePillBlur from './BalancePill.blur';
import BalancePillFlat from './BalancePill.flat';
import BalancePillLiquid from './BalancePill.liquid';
import type { BalancePillProps } from './BalancePill.types';

const BalancePill = defineVariants<BalancePillProps>('BalancePill', {
  liquid: BalancePillLiquid,
  blur: BalancePillBlur,
  flat: BalancePillFlat,
});

export default BalancePill;
