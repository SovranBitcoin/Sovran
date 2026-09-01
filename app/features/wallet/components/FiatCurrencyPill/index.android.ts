/**
 * Android bundle entry. Android stays on the native Material menu (flat by
 * design) — the same split the UnitSwitcherPill uses, and the two pills stack
 * in the same balance column. Skipping the liquid and flat iOS variants keeps
 * `@expo/ui/swift-ui` and `ActionSheetIOS` off the Android graph.
 */
import { defineVariants } from '@/shared/ui/capability';

import { FiatCurrencyPillAndroidMenu } from './FiatCurrencyPill.androidMenu';
import type { FiatCurrencyPillProps } from './useFiatCurrencyPill';

export const FiatCurrencyPill = defineVariants<FiatCurrencyPillProps>('FiatCurrencyPill', {
  flat: FiatCurrencyPillAndroidMenu,
});
