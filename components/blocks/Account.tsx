import React, { useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import 'react-native-get-random-values';
import { Animated, Platform } from 'react-native';

import { View, HStack, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { BitcoinMaskIcon, DollarMaskIcon, EuroMaskIcon, PoundMaskIcon } from 'assets/icons';
import { PrimaryBalance } from 'components/blocks/PrimaryBalance';

import { memoizedGetBackgroundImage } from 'redux/settings';
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
}

export function Account({ accounts, account }: AccountProps): React.ReactElement {
  const { getPrimaryColor } = useTheme();

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

  const image = useSelector(memoizedGetBackgroundImage);

  return (
    <NonGestureView
      key={account.unit}
      index={0}
      style={{
        overflow: 'hidden',
        zIndex: 10,
        height: 335,
        width: '100%',
      }}>
      <View>
        <View
          className="z-[9] p-4"
          style={{
            marginTop: Platform.OS === 'web' ? 64 : 16,
            paddingBottom: 0,
            paddingTop: 16,
          }}
        />
        <View className="h-[110px]" />
        <PrimaryBalance account={account} />
      </View>

      <VStack align="center" justify="space-around" className="w-full self-center">
        <HStack />

        <HStack spacing={2}>
          {/* Onchain account indicators */}
          {renderDotIndicators(accounts, 0)}
        </HStack>
      </VStack>

      <View
        className="absolute bottom-6 -z-10 h-[300px] w-full overflow-hidden"
        style={{
          borderBottomColor: getPrimaryColor('600'),
          borderBottomWidth: 0.2,
        }}>
        <View className="absolute bottom-0 right-0 rounded-full">
          {!image && renderCurrencyIcon()}
        </View>
      </View>
    </NonGestureView>
  );
}
