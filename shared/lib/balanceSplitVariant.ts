// ⛔ These values are PERSISTED (settingsStore `balanceSplitVariant`). Renaming
// or removing one is a breaking change to durable user data: a device holding
// the old value will fail the persist schema parse. Because the settings
// `merge` discards the WHOLE blob on any field failure, that silently wipes
// terms acceptance + onboarding + every setting (this exact rename already did
// once). The schema's `.catch(default)` now degrades unknown values instead of
// wiping — keep that in place, and prefer adding a new value over renaming one.
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
