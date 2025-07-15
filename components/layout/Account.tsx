import React, { useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import 'react-native-get-random-values';
import { Animated, Platform, StyleSheet } from 'react-native';

import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { BitcoinMaskIcon, DollarMaskIcon, EuroMaskIcon, PoundMaskIcon } from 'assets/icons';
import { PrimaryBalance } from 'components/layout/PrimaryBalance';

import { greys, Theme } from 'helper/colors';
import { memoizedGetBackgroundImage, memoizedGetTheme } from 'helper/redux/settings';
import { NonGestureView } from './NonGestureView';

// Define proper interfaces for our data types
interface AccountData {
  key: string;
  unit: string;
  type: string;
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

  // Memoize derived data
  const onchainAccounts = accounts.filter((acc) => acc.type === 'onchain');
  const ecashAccounts = accounts.filter((acc) => acc.type !== 'onchain');

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
      const isActive =
        actualIndex ===
        accounts.findIndex((a) => a.unit === account.unit && a.type === account.type);

      return (
        <Text
          key={actualIndex}
          weight={isActive ? 'bold' : 'regular'}
          size={16}
          style={{
            color: isActive ? greys(theme)[0] : greys(theme)[700],
            marginLeft: 1,
            marginRight: 1,
            marginTop: 3,
          }}>
          •
        </Text>
      );
    });
  };

  const image = useSelector(memoizedGetBackgroundImage);

  return (
    <NonGestureView key={account.key} index={0} style={styles.nonGestureView}>
      <View style={styles.transparentBackground}>
        <View style={styles.transparentBackgroundWithPadding} />
        <View
          style={{
            height: 110,
          }}></View>
        <PrimaryBalance account={account} />
      </View>

      <View style={styles.maxWidthContainer}>
        <View style={styles.transparentBackgroundRow} />

        <View style={styles.transparentBackgroundRow}>
          {/* Onchain account indicators */}
          {renderDotIndicators(onchainAccounts, 0)}

          {/* Spacer between indicators */}
          <Text
            weight="bold"
            size={10}
            style={{
              color: greys(theme)[500],
              marginLeft: 4,
              marginRight: 4,
              marginTop: 6,
            }}>
            {' '}
          </Text>

          {/* Ecash account indicators */}
          {renderDotIndicators(ecashAccounts, onchainAccounts.length)}
        </View>
      </View>

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
      // backgroundColor: greys(theme)[950], // Using a default theme value
      overflow: 'hidden',
      zIndex: 1,
      height: 335,
      width: '100%',
    },
    transparentBackground: {
      backgroundColor: 'transparent',
    },
    transparentBackgroundWithPadding: {
      backgroundColor: 'transparent',
      padding: 16,
      marginTop: Platform.OS === 'web' ? 64 : 16,
      paddingBottom: 0,
      flexDirection: 'row',
      alignItems: 'center',
      paddingTop: 16,
      zIndex: 9,
      justifyContent: 'space-around',
    },
    transparentBackgroundRow: {
      flexDirection: 'row',
      backgroundColor: 'transparent',
    },
    accountUnitText: {
      color: greys(theme)[100], // Using a default theme value
    },
    maxWidthContainer: {
      width: '100%', // Fixed invalid CSS value
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'space-around',
      backgroundColor: 'transparent',
      alignSelf: 'center',
    },
    absoluteBottomBorder: {
      position: 'absolute',
      bottom: PLATFORM_BOTTOM_OFFSET,
      borderBottomColor: greys(theme)[600], // Using a default theme value
      borderBottomWidth: 0.2,
      zIndex: -1,
      height: 1,
      backgroundColor: 'transparent',
      overflow: 'hidden',
      width: '100%',
    },
    absoluteRightBottomBorder: {
      position: 'absolute',
      bottom: PLATFORM_BOTTOM_OFFSET,
      borderBottomColor: greys(theme)[600], // Using a default theme value
      borderBottomWidth: 0.2,
      zIndex: -1,
      height: 300,
      backgroundColor: 'transparent',
      overflow: 'hidden',
      width: '100%',
    },
    bottomNegative: {
      position: 'absolute',
      bottom: 0,
      backgroundColor: 'transparent',
      borderRadius: 10000,
      right: 0,
    },
  });
