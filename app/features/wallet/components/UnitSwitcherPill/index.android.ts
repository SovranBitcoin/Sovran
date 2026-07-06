/**
 * Android bundle entry. Android stays on the CapsuleButton fallback (flat by
 * design) with the global bottom-sheet menu — inline/native menus misbehave
 * there. Skipping the liquid variant keeps `liquid-glass-menu`,
 * `expo-glass-effect`, and `@react-native-menu/menu` off the Android graph.
 */
import { defineVariants } from '@/shared/ui/capability';

import { UnitSwitcherPillFallback } from './UnitSwitcherPill.fallback';
import type { UnitSwitcherPillProps } from './useUnitSwitcherPill';

export const UnitSwitcherPill = defineVariants<UnitSwitcherPillProps>('UnitSwitcherPill', {
  flat: UnitSwitcherPillFallback,
});
