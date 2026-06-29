import type { BalanceSplitVariant } from '@/shared/lib/balanceSplitVariant';
import { CompactRowsVariant } from './CompactRowsVariant';
import { HeroMinimalVariant } from './HeroMinimalVariant';
import { ChartLedVariant } from './ChartLedVariant';
import type { DistributionVariantComponent } from './types';

export type { DistributionVariantProps, DistributionVariantComponent } from './types';

/**
 * Enum → component map for the Balance-split variants. `satisfies` makes adding
 * a variant to the enum a compile error until it is wired up here.
 */
export const BALANCE_SPLIT_VARIANT_COMPONENTS = {
  'compact-rows': CompactRowsVariant,
  'hero-minimal': HeroMinimalVariant,
  'chart-led': ChartLedVariant,
} satisfies Record<BalanceSplitVariant, DistributionVariantComponent>;
