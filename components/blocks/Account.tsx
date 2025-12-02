import React from 'react';
import 'react-native-get-random-values';

import { View, HStack, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { BitcoinMaskIcon, DollarMaskIcon, EuroMaskIcon, PoundMaskIcon } from 'assets/icons';
import { PrimaryBalance } from 'components/blocks/PrimaryBalance';

import { useSettingsStore, isBackgroundImageTheme } from 'stores/settingsStore';
import { useTheme } from 'providers/ThemeProvider';
import { NonGestureView } from './NonGestureView';

interface AccountData {
  unit: string;
}

interface AccountProps {
  accounts: AccountData[];
  account: AccountData;
  goToIndex: (index: number) => void;
  pagerHeight: number;
}

export function Account({ accounts, account, pagerHeight }: AccountProps): React.ReactElement {
  const { getPrimaryColor } = useTheme();
  const theme = useSettingsStore((state) => state.getTheme());
  const hasBackgroundImage = isBackgroundImageTheme(theme);

  // Function to render currency icon based on unit
  const renderCurrencyIcon = () => {
    switch (account.unit) {
      case 'sat':
        return <BitcoinMaskIcon />;
      case 'usd':
        return <DollarMaskIcon />;
      case 'eur':
        return <EuroMaskIcon />;
      case 'gbp':
        return <PoundMaskIcon />;
      default:
        return null;
    }
  };

  // Function to render account dot indicators
  const renderDotIndicators = () => {
    return accounts.map((acc, index) => {
      const isActive = acc.unit === account.unit;

      return (
        <Text
          key={index}
          weight={isActive ? 'bold' : 'regular'}
          size={16}
          style={{
            color: isActive ? getPrimaryColor('0') : getPrimaryColor('700'),
            marginTop: 3,
          }}>
          •
        </Text>
      );
    });
  };

  return (
    <NonGestureView
      key={account.unit}
      index={0}
      style={{
        overflow: 'hidden',
        zIndex: 10,
        height: pagerHeight,
        width: '100%',
      }}>
      {/* Centered content area using flex spacers */}
      <VStack style={{ flex: 1 }}>
        {/* Top spacer - pushes content down */}
        <View style={{ flex: 1 }} />

        {/* Content: fiat, sats, dots */}
        <VStack align="center" gap={8}>
          <PrimaryBalance account={account} />
          <HStack spacing={2}>{renderDotIndicators()}</HStack>
        </VStack>

        {/* Bottom spacer - pushes content up (equal to top spacer) */}
        <View style={{ flex: 1 }} />
      </VStack>

      {/* Background currency icon - decorative only */}
      {!hasBackgroundImage && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: 24,
            right: 0,
            zIndex: -10,
          }}>
          {renderCurrencyIcon()}
        </View>
      )}
    </NonGestureView>
  );
}
