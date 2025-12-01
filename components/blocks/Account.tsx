import React, { useEffect, useRef } from 'react';
import 'react-native-get-random-values';
import { Animated, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { View, HStack, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { BitcoinMaskIcon, DollarMaskIcon, EuroMaskIcon, PoundMaskIcon } from 'assets/icons';
import { PrimaryBalance } from 'components/blocks/PrimaryBalance';

import { useSettingsStore, isBackgroundImageTheme } from 'stores/settingsStore';
import { useTheme } from 'providers/ThemeProvider';
import { NonGestureView } from './NonGestureView';

// Define proper interfaces for our data types
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
  const insets = useSafeAreaInsets();

  // Animation values
  const spinValue = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Start spin animation on mount
  useEffect(() => {
    const spin = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1250,
        useNativeDriver: true,
      })
    );
    spin.start();

    return () => spin.stop();
  }, [spinValue]);

  // Start pulse animation on mount
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.9,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();

    return () => pulse.stop();
  }, [pulseAnim]);

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
  const renderDotIndicators = (accountsToRender: AccountData[], startIndex: number) => {
    return accountsToRender.map((_, index) => {
      const actualIndex = startIndex + index;
      const isActive = actualIndex === accounts.findIndex((a) => a.unit === account.unit);

      return (
        <Text
          key={actualIndex}
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

  const theme = useSettingsStore((state) => state.getTheme());
  const image = isBackgroundImageTheme(theme) ? theme : null;

  // Account for safe area at top (status bar + navigation header)
  const topInset = Platform.OS === 'web' ? 64 : insets.top + 56;

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
      {/* Main content area with flexbox centering */}
      <VStack
        align="center"
        justify="center"
        style={{
          flex: 1,
          paddingTop: topInset,
        }}>
        <PrimaryBalance account={account} />

        <HStack spacing={2} style={{ marginTop: 8 }}>
          {/* Onchain account indicators */}
          {renderDotIndicators(accounts, 0)}
        </HStack>
      </VStack>

      {/* Background currency icon - decorative only */}
      {!image && (
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
