/**
 * Android bundle entry. Flat-only — no SwiftUI, no ActionSheetIOS, no
 * currency menu (matches today's `FiatCurrencyPill.android.tsx` behavior).
 */
import { defineVariants } from '@/shared/ui/capability';

import { FiatCurrencyPillFlat } from './FiatCurrencyPill.flat';
import type { FiatCurrencyPillProps } from './useFiatCurrencyPill';

export const FiatCurrencyPill = defineVariants<FiatCurrencyPillProps>('FiatCurrencyPill', {
  flat: FiatCurrencyPillFlat,
});
