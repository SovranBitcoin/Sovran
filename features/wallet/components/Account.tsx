import React from 'react';
import 'react-native-get-random-values';

import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import { BitcoinMaskIcon, DollarMaskIcon, EuroMaskIcon, PoundMaskIcon } from 'assets/icons';
import { PrimaryBalance } from '@/features/wallet/components/PrimaryBalance';

import { useSettingsStore, isBackgroundImageTheme } from '@/shared/stores/global/settingsStore';
import { NonGestureView } from './NonGestureView';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log } from '@/shared/lib/logger';

interface AccountData {
  unit: string;
}

interface AccountProps {
  accounts: AccountData[];
  account: AccountData;
  pagerHeight: number;
}

const CURRENCY_ICONS: Record<string, React.FC> = {
  sat: BitcoinMaskIcon,
  usd: DollarMaskIcon,
  eur: EuroMaskIcon,
  gbp: PoundMaskIcon,
};

export function Account({ accounts, account, pagerHeight }: AccountProps): React.ReactElement {
  const [foreground, surfaceTertiary] = useThemeColor(['foreground', 'surface-tertiary'] as const);
  const theme = useSettingsStore((state) => state.getTheme());
  const hasBackgroundImage = isBackgroundImageTheme(theme);

  const CurrencyIcon = CURRENCY_ICONS[account.unit];

  return (
    <Log name="Account">
      <NonGestureView
        key={account.unit}
        style={{ overflow: 'hidden', zIndex: 10, height: pagerHeight, width: '100%' }}>
        <VStack style={{ flex: 1 }}>
          <View style={{ flex: 1 }} />

          <VStack align="center" gap={8}>
            <PrimaryBalance account={account} />
            <HStack spacing={2}>
              {accounts.map((acc, index) => {
                const isActive = acc.unit === account.unit;
                return (
                  <Text
                    key={index}
                    weight={isActive ? 'bold' : 'regular'}
                    size={16}
                    style={{
                      color: isActive ? foreground : surfaceTertiary,
                      marginTop: 3,
                    }}>
                    •
                  </Text>
                );
              })}
            </HStack>
          </VStack>

          <View style={{ flex: 1 }} />
        </VStack>

        {!hasBackgroundImage && CurrencyIcon ? (
          <View pointerEvents="none" className="absolute bottom-6 right-0 z-[-10]">
            <CurrencyIcon />
          </View>
        ) : null}
      </NonGestureView>
    </Log>
  );
}
