import React, { useCallback, useMemo } from 'react';
import { ActionSheetIOS, StyleSheet } from 'react-native';
import opacity from 'hex-color-opacity';

import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Text } from '@/shared/ui/primitives/Text';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { useFiatCurrencyPill, type FiatCurrencyPillProps } from './useFiatCurrencyPill';

const CURRENCY_SHEET_OPTIONS = ['USD', 'EUR', 'GBP', 'Cancel'];
const CANCEL_BUTTON_INDEX = 3;

export function FiatCurrencyPillFlat(props: FiatCurrencyPillProps): React.ReactElement {
  const { text, iosHeight, handleSelectCurrency, onPress, enableCurrencyMenu, textSize } =
    useFiatCurrencyPill(props);
  const colorScheme = useColorScheme();
  const [textColor, surfaceSecondary, muted] = useThemeColor([
    'foreground',
    'surface-secondary',
    'muted',
  ] as const);
  const pillStyle = useMemo(
    () => [
      styles.pill,
      {
        backgroundColor: surfaceSecondary,
        borderColor: opacity(muted, 0.3),
        minHeight: iosHeight,
      },
    ],
    [iosHeight, muted, surfaceSecondary]
  );

  const openCurrencySheet = useCallback(() => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: CURRENCY_SHEET_OPTIONS,
        cancelButtonIndex: CANCEL_BUTTON_INDEX,
        userInterfaceStyle: colorScheme,
      },
      (buttonIndex) => {
        if (buttonIndex === 0) handleSelectCurrency('usd');
        if (buttonIndex === 1) handleSelectCurrency('eur');
        if (buttonIndex === 2) handleSelectCurrency('gbp');
      }
    );
  }, [handleSelectCurrency, colorScheme]);

  const primaryHandler = enableCurrencyMenu && !onPress ? openCurrencySheet : onPress;
  const longPressHandler = enableCurrencyMenu && onPress ? openCurrencySheet : undefined;

  return (
    <Pressable
      disabled={!primaryHandler && !longPressHandler}
      onPress={primaryHandler}
      onLongPress={longPressHandler}>
      <HStack
        align="center"
        justify="center"
        gap={6}
        className="overflow-hidden rounded-full"
        style={pillStyle}>
        <Text overpass size={textSize} bold color={textColor} style={styles.text}>
          {text}
        </Text>
      </HStack>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  text: {
    letterSpacing: 0.3,
  },
});
