/**
 * iOS bundle entry. iOS 26 → native glass + UIMenu morph (same recipe as
 * FiatCurrencyPill — the two pills stack in the same balance column); older
 * iOS → the CapsuleButton fallback, which tiers itself (blur/flat) and opens
 * the global bottom-sheet menu. Android imports a separate index that omits
 * the liquid variant, keeping `liquid-glass-menu`, `expo-glass-effect`, and
 * `@react-native-menu/menu` off the Android graph.
 */
import { defineVariants } from '@/shared/ui/capability';

import { UnitSwitcherPillFallback } from './UnitSwitcherPill.fallback';
import { UnitSwitcherPillLiquid } from './UnitSwitcherPill.liquid';
import type { UnitSwitcherPillProps } from './useUnitSwitcherPill';

export const UnitSwitcherPill = defineVariants<UnitSwitcherPillProps>('UnitSwitcherPill', {
  liquid: UnitSwitcherPillLiquid,
  blur: UnitSwitcherPillFallback,
  flat: UnitSwitcherPillFallback,
});
