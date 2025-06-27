import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { useSelector } from 'react-redux';

import { StyledText } from 'components/common/Text';
import { View } from 'components/common/View';

import { greens, greys, shades } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { LightningUnit } from 'assets/icons';

type CurrencySymbol = '$' | '€' | '£' | 'sat' | string;
type TransactionType = 'send' | 'receive';

interface NumberInputProps {
  type?: TransactionType;
  currency?: string;
  value: number | string;
}

export function NumberInput({
  type = 'send',
  currency = '£',
  value,
}: NumberInputProps): React.ReactNode {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const theme = useSelector(memoizedGetTheme);

  // Mapping currency to symbol
  const currencySymbols: Record<string, CurrencySymbol> = {
    usd: '$',
    eur: '€',
    gbp: '£',
    sat: 'sat',
  };

  const currencySymbol: CurrencySymbol = currencySymbols[currency.toLowerCase()] || currency;
  const isLightningUnit = currencySymbol === 'sat';
  const isSingleCharSymbol = currencySymbol.length === 1;

  useEffect(() => {
    const length = value.toString().length;
    const newScale = length > 3 ? 1 - (length - 3) * 0.075 : 1;

    Animated.timing(scaleAnim, {
      toValue: newScale,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [value, scaleAnim]);

  const calculateFontSize = (text: string | number): number => {
    const maxFontSize = 64;
    const minFontSize = 36;
    const shrinkStartLength = 3;
    const shrinkEndLength = 9;

    const textLength = String(text).length;

    if (textLength <= shrinkStartLength) {
      return maxFontSize;
    }

    if (textLength >= shrinkEndLength) {
      return minFontSize;
    }

    const shrinkRange = shrinkEndLength - shrinkStartLength;
    const fontSize =
      maxFontSize - ((textLength - shrinkStartLength) * (maxFontSize - minFontSize)) / shrinkRange;

    return Math.max(minFontSize, fontSize);
  };

  const formatNumberWithSpaces = (number: string | number): string => {
    const numberString = String(number);
    return numberString.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  };

  const getColorForType = (): string => {
    if (!value) return theme.greys[700];
    return type === 'receive' ? greens[300] : shades[300];
  };

  return (
    <View className="bg-transparent">
      <Animated.View
        style={{
          display: 'flex',
          justifyContent: 'center',
          flexDirection: 'row',
          alignItems: 'center',
          flex: 1,
          margin: 0,
          padding: 0,
          overflow: 'visible',
          transform: [{ scale: scaleAnim }],
          marginLeft: isSingleCharSymbol ? -22 : 22,
        }}>
        {isSingleCharSymbol && (
          <StyledText
            style={{
              fontFamily: 'OverpassRegular',
              color: value ? shades[100] : greys()[400],
              fontSize: 28,
              marginRight: 4,
              marginTop: 12,
              flexShrink: 0,
              overflow: 'hidden',
            }}
            secondary={!value}
            primary={type === 'send' && Boolean(value)}
            negative={type === 'receive' && Boolean(value)}>
            {currencySymbol}
          </StyledText>
        )}

        <View className="flex h-[100px] flex-row items-center justify-center overflow-visible bg-transparent">
          <StyledText
            style={{
              fontFamily: 'OverpassHeavy',
              fontSize: calculateFontSize(value),
              margin: 0,
              padding: 0,
              zIndex: 100,
              flexShrink: 0,
              overflow: 'visible',
            }}
            secondary={!value}
            primary={type === 'send' && Boolean(value)}
            negative={type === 'receive' && Boolean(value)}>
            {value ? formatNumberWithSpaces(value) : '0'}
          </StyledText>
        </View>

        {isLightningUnit ? (
          <View className="flex flex-row items-center justify-center bg-transparent">
            <LightningUnit color={getColorForType()} />
          </View>
        ) : (
          !isSingleCharSymbol && (
            <StyledText
              secondary={!value}
              primary={type === 'send' && Boolean(value)}
              negative={type === 'receive' && Boolean(value)}
              style={{
                fontFamily: 'OverpassRegular',
                fontSize: 28,
                marginRight: 4,
                marginTop: 12,
                flexShrink: 0,
                overflow: 'hidden',
              }}>
              {currencySymbol}
            </StyledText>
          )
        )}
      </Animated.View>
    </View>
  );
}
