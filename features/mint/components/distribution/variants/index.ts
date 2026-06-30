import type { BalanceSplitVariant } from '@/shared/lib/balanceSplitVariant';
import { MinimalListVariant } from './MinimalListVariant';
import { TotalLedVariant } from './TotalLedVariant';
import { DonutVariant } from './DonutVariant';
import type { DistributionVariantComponent } from './types';

export type { DistributionVariantProps, DistributionVariantComponent } from './types';

/**
 * Enum → component map for the Balance-split variants. `satisfies` makes adding
 * a variant to the enum a compile error until it is wired up here.
 */
export const BALANCE_SPLIT_VARIANT_COMPONENTS = {
  list: MinimalListVariant,
  total: TotalLedVariant,
  donut: DonutVariant,
} satisfies Record<BalanceSplitVariant, DistributionVariantComponent>;
