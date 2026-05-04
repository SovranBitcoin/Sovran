import React from 'react';
import 'react-native-get-random-values';

import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { BitcoinMaskIcon, DollarMaskIcon, EuroMaskIcon, PoundMaskIcon } from 'assets/icons';
import { PrimaryBalance } from '@/features/wallet/components/PrimaryBalance';

import { isBackgroundImageTheme } from '@/shared/stores/global/settingsStore';
import { useUnitWallpaper } from '@/shared/providers/ProfileWallpaperProvider';
import { Log } from '@/shared/lib/logger';

interface AccountData {
  unit: string;
}

interface AccountProps {
  account: AccountData;
  pagerHeight: number;
}

const CURRENCY_ICONS: Record<string, React.FC> = {
  sat: BitcoinMaskIcon,
  usd: DollarMaskIcon,
  eur: EuroMaskIcon,
  gbp: PoundMaskIcon,
};

export function Account({ account, pagerHeight }: AccountProps): React.ReactElement {
  const theme = useUnitWallpaper(account.unit);
  const hasBackgroundImage = isBackgroundImageTheme(theme);

  const CurrencyIcon = CURRENCY_ICONS[account.unit];

  return (
    <Log name="Account">
      <View
        style={{ overflow: 'hidden', zIndex: 10, height: pagerHeight, width: '100%' }}
        className="flex">
        {/*
         * Weighted fillers: top flex:2, bottom flex:1 pushes the primary
         * balance closer to the bottom edge of the pager so the secondary
         * action row below sits right under the balance instead of floating
         * in empty space. Centred (flex:1/flex:1) felt too lonely after
         * `pagerHeight` was tightened.
         */}
        <VStack style={{ flex: 1 }}>
          <View style={{ flex: 2 }} />
          <VStack align="center" gap={8}>
            <PrimaryBalance account={account} />
          </VStack>
          <View style={{ flex: 1 }} />
        </VStack>

        {!hasBackgroundImage && CurrencyIcon ? (
          <View pointerEvents="none" className="absolute bottom-6 right-0 z-[-10]">
            <CurrencyIcon />
          </View>
        ) : null}
      </View>
    </Log>
  );
}
