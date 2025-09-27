import React, { useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import 'react-native-get-random-values';
import { Animated, Platform, StyleSheet } from 'react-native';

import { View, HStack, VStack } from 'components/common/View';
import { Text } from 'components/common/Text';
import { BitcoinMaskIcon, DollarMaskIcon, EuroMaskIcon, PoundMaskIcon } from 'assets/icons';
import { PrimaryBalance } from 'components/layout/PrimaryBalance';

import { greys, Theme } from 'helper/colors';
import { memoizedGetBackgroundImage, memoizedGetTheme } from 'helper/redux/settings';
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
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

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
            color: isActive ? greys(theme)[0] : greys(theme)[700],
            marginTop: 3,
          }}>
          •
        </Text>
      );
    });
  };

  const image = useSelector(memoizedGetBackgroundImage);

  return (
    <NonGestureView key={account.unit} index={0} style={styles.nonGestureView}>
      <View>
        <View
          style={{
            padding: 16,
            marginTop: Platform.OS === 'web' ? 64 : 16,
            paddingBottom: 0,
            paddingTop: 16,
            zIndex: 9,
          }}
        />
        <View
          style={{
            height: 110,
          }}></View>
        <PrimaryBalance account={account} />
      </View>

      <VStack align="center" justify="space-around" style={{ width: '100%', alignSelf: 'center' }}>
        <HStack />

        <HStack spacing={2}>
          {/* Onchain account indicators */}
          {renderDotIndicators(accounts, 0)}
        </HStack>
      </VStack>

      <View style={styles.absoluteRightBottomBorder}>
        <View style={styles.bottomNegative}>{!image && renderCurrencyIcon()}</View>
      </View>
    </NonGestureView>
  );
}

// Use a constant for platform-specific values
const PLATFORM_BOTTOM_OFFSET = 24;

// Using function to create styles to respect the existing pattern
// but with proper typing for theme
const createStyles = (theme: Theme) =>
  StyleSheet.create({
    nonGestureView: {
      overflow: 'hidden',
      zIndex: 1,
      height: 335,
      width: '100%',
    },
    absoluteRightBottomBorder: {
      position: 'absolute',
      bottom: PLATFORM_BOTTOM_OFFSET,
      borderBottomColor: greys(theme)[600], // Using a default theme value
      borderBottomWidth: 0.2,
      zIndex: -1,
      height: 300,
      overflow: 'hidden',
      width: '100%',
    },
    bottomNegative: {
      position: 'absolute',
      bottom: 0,
      borderRadius: 10000,
      right: 0,
    },
  });
