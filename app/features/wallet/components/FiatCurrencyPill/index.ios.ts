/**
 * iOS bundle entry. iOS 26+ → SwiftUI glass + Menu; older iOS → flat fallback
 * with ActionSheetIOS currency selection. Android imports a separate index that
 * omits both, keeping `@expo/ui/swift-ui` and `ActionSheetIOS` off the Android
 * graph.
 */
import { createElement } from 'react';

import { useAppStyle } from '@/shared/styles/appStyle';
import { defineVariants } from '@/shared/ui/capability';

import { FiatCurrencyPillFlat } from './FiatCurrencyPill.flat';
import { FiatCurrencyPillLiquid } from './FiatCurrencyPill.liquid';
import type { FiatCurrencyPillProps } from './useFiatCurrencyPill';

const GlassFiatCurrencyPill = defineVariants<FiatCurrencyPillProps>('FiatCurrencyPill', {
  liquid: FiatCurrencyPillLiquid,
  blur: FiatCurrencyPillFlat,
  flat: FiatCurrencyPillFlat,
});

/**
 * The glass pill belongs to the glass style. In every other style the
 * conversion is a line of type under the balance (the flat variant draws it),
 * on iOS exactly as on Android, whatever the device could render.
 */
export function FiatCurrencyPill(props: FiatCurrencyPillProps) {
  const glass = useAppStyle().surface === 'glass';
  return createElement(glass ? GlassFiatCurrencyPill : FiatCurrencyPillFlat, props);
}
