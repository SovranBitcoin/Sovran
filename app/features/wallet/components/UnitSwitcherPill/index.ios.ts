/**
 * iOS bundle entry. iOS 26 → native glass + UIMenu morph (same recipe as
 * FiatCurrencyPill — the two pills stack in the same balance column); older
 * iOS → the CapsuleButton fallback, which tiers itself (blur/flat) and opens
 * the global bottom-sheet menu. Android imports a separate index that omits
 * the liquid variant, keeping `liquid-glass-menu`, `expo-glass-effect`, and
 * `@react-native-menu/menu` off the Android graph.
 */
import { createElement } from 'react';

import { useAppStyle } from '@/shared/styles/appStyle';
import { defineVariants } from '@/shared/ui/capability';

import { UnitSwitcherPillFallback } from './UnitSwitcherPill.fallback';
import { UnitSwitcherPillLiquid } from './UnitSwitcherPill.liquid';
import type { UnitSwitcherPillProps } from './useUnitSwitcherPill';

const GlassUnitSwitcherPill = defineVariants<UnitSwitcherPillProps>('UnitSwitcherPill', {
  liquid: UnitSwitcherPillLiquid,
  blur: UnitSwitcherPillFallback,
  flat: UnitSwitcherPillFallback,
});

/**
 * Over the balance, the glass pill belongs to the glass style; every other
 * style shows the account as a plain label (the fallback draws it), on iOS
 * exactly as on Android. In a header it stays a glass control beside the
 * other header controls.
 */
export function UnitSwitcherPill(props: UnitSwitcherPillProps & { header?: boolean }) {
  const glass = useAppStyle().surface === 'glass';
  return createElement(
    glass || props.header ? GlassUnitSwitcherPill : UnitSwitcherPillFallback,
    props
  );
}
