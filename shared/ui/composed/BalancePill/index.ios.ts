/**
 * iOS bundle entry. Liquid glass gets the native glass renderer; every
 * non-liquid capability gets the shared flat fallback.
 */
import { defineVariants } from '@/shared/ui/capability';

import BalancePillFlat from './BalancePill.flat';
import BalancePillLiquid from './BalancePill.liquid';
import type { BalancePillProps } from './BalancePill.types';

const BalancePill = defineVariants<BalancePillProps>('BalancePill', {
  liquid: BalancePillLiquid,
  blur: BalancePillFlat,
  flat: BalancePillFlat,
});

export default BalancePill;
