import { defineVariants } from '@/shared/ui/capability';

import { FiatCurrencyPillAndroidMenu } from './FiatCurrencyPill.androidMenu';
import type { FiatCurrencyPillProps } from './useFiatCurrencyPill';

export const FiatCurrencyPill = defineVariants<FiatCurrencyPillProps>('FiatCurrencyPill', {
  flat: FiatCurrencyPillAndroidMenu,
});
