export const BALANCE_SPLIT_VARIANTS = ['compact-rows', 'hero-minimal', 'chart-led'] as const;

export type BalanceSplitVariant = (typeof BALANCE_SPLIT_VARIANTS)[number];

// Dense ranked rows with an always-visible slider — the closest in information
// density to the original editor, so it's the safe default for the dev toggle.
export const DEFAULT_BALANCE_SPLIT_VARIANT: BalanceSplitVariant = 'compact-rows';

export const BALANCE_SPLIT_VARIANT_LABELS: Record<BalanceSplitVariant, string> = {
  'compact-rows': 'Compact rows',
  'hero-minimal': 'Hero total',
  'chart-led': 'Donut chart',
};

export const BALANCE_SPLIT_VARIANT_DESCRIPTIONS: Record<BalanceSplitVariant, string> = {
  'compact-rows': 'Dense ranked rows with a proportion bar and inline sliders.',
  'hero-minimal': 'Large total to split, with a tap-to-edit breakdown.',
  'chart-led': 'A proportion donut with a tap-to-edit legend.',
};

export function isBalanceSplitVariant(value: string): value is BalanceSplitVariant {
  return (BALANCE_SPLIT_VARIANTS as readonly string[]).includes(value);
}
