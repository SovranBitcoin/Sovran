import React, { useCallback } from 'react';
import { ActionSheetIOS } from 'react-native';

import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { useFiatCurrencyPill, type FiatCurrencyPillProps } from './useFiatCurrencyPill';
import { FiatPillShell, fiatPillHandlers } from './FiatCurrencyPill.shell';

const CURRENCY_SHEET_OPTIONS = ['USD', 'EUR', 'GBP', 'Cancel'];
const CANCEL_BUTTON_INDEX = 3;

export function FiatCurrencyPillFlat(props: FiatCurrencyPillProps): React.ReactElement {
  const {
    text,
    iosHeight,
    handleSelectCurrency,
    onPress,
    enableCurrencyMenu,
    textSize,
    testID,
    accessibilityLabel,
  } = useFiatCurrencyPill(props);
  const colorScheme = useColorScheme();

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

  const { primaryHandler, longPressHandler } = fiatPillHandlers(
    enableCurrencyMenu,
    onPress,
    openCurrencySheet
  );

  return (
    <FiatPillShell
      text={text}
      textSize={textSize}
      iosHeight={iosHeight}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      primaryHandler={primaryHandler}
      longPressHandler={longPressHandler}
    />
  );
}
