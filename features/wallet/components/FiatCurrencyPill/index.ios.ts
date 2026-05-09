/**
 * iOS bundle entry. iOS 26+ → SwiftUI glass + Menu; older iOS → tinted-flat
 * with ActionSheetIOS for currency selection. Android imports a separate
 * index that omits both, keeping `@expo/ui/swift-ui` and `ActionSheetIOS`
 * off the Android graph.
 */
import { defineVariants } from '@/shared/ui/capability';

import { FiatCurrencyPillBlur } from './FiatCurrencyPill.blur';
import { FiatCurrencyPillFlat } from './FiatCurrencyPill.flat';
import { FiatCurrencyPillLiquid } from './FiatCurrencyPill.liquid';
import type { FiatCurrencyPillProps } from './useFiatCurrencyPill';

export type { FiatCurrencyPillProps } from './useFiatCurrencyPill';

export const FiatCurrencyPill = defineVariants<FiatCurrencyPillProps>('FiatCurrencyPill', {
  liquid: FiatCurrencyPillLiquid,
  blur: FiatCurrencyPillBlur,
  flat: FiatCurrencyPillFlat,
});
