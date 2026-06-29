export const BALANCE_SPLIT_VARIANTS = ['list', 'total', 'donut'] as const;

export type BalanceSplitVariant = (typeof BALANCE_SPLIT_VARIANTS)[number];

// A bare slider list — the most subtracted layout, so it's the default.
export const DEFAULT_BALANCE_SPLIT_VARIANT: BalanceSplitVariant = 'list';

export const BALANCE_SPLIT_VARIANT_LABELS: Record<BalanceSplitVariant, string> = {
  list: 'List',
  total: 'Total',
  donut: 'Donut',
};

export const BALANCE_SPLIT_VARIANT_DESCRIPTIONS: Record<BalanceSplitVariant, string> = {
  list: 'Just the sliders. Nothing else.',
  total: 'A quiet total over the sliders.',
  donut: 'A proportion donut over the sliders.',
};

export function isBalanceSplitVariant(value: string): value is BalanceSplitVariant {
  return (BALANCE_SPLIT_VARIANTS as readonly string[]).includes(value);
}
