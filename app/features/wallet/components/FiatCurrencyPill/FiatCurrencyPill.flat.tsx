import React, { useCallback } from 'react';
import { ActionSheetIOS } from 'react-native';
import { accountUnitLabel, FIAT_UNITS } from 'wallet';

import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { useFiatCurrencyPill, type FiatCurrencyPillProps } from './useFiatCurrencyPill';
import { FiatPillShell } from './FiatCurrencyPill.shell';

const CURRENCY_SHEET_OPTIONS = [...FIAT_UNITS.map((unit) => accountUnitLabel(unit)), 'Cancel'];
const CANCEL_BUTTON_INDEX = FIAT_UNITS.length;

export function FiatCurrencyPillFlat(props: FiatCurrencyPillProps): React.ReactElement {
  const {
    text,
    iosHeight,
    handleSelectCurrency,
    handlersFor,
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
        const picked = FIAT_UNITS[buttonIndex];
        if (picked) handleSelectCurrency(picked);
      }
    );
  }, [handleSelectCurrency, colorScheme]);

  const { primaryHandler, longPressHandler } = handlersFor(openCurrencySheet);

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
