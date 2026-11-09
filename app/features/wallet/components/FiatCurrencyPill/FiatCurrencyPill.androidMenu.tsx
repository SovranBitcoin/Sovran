import { FIAT_UNITS } from 'wallet';

import { unitFlagIcon, unitName } from '@/shared/lib/cashu/unitPresentation';
import React, { useCallback } from 'react';

import Icon from 'assets/icons';
import { pickOption } from '@/shared/lib/picker/openPicker';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useFiatCurrencyPill, type FiatCurrencyPillProps } from './useFiatCurrencyPill';
import { FiatPillShell } from './FiatCurrencyPill.shell';

const CURRENCY_OPTIONS = FIAT_UNITS.map((currency) => ({
  currency,
  label: unitName(currency),
  icon: unitFlagIcon(currency) ?? '',
}));

export function FiatCurrencyPillAndroidMenu(props: FiatCurrencyPillProps): React.ReactElement {
  const {
    text,
    iosHeight,
    handleSelectCurrency,
    handlersFor,
    textSize,
    testID,
    accessibilityLabel,
  } = useFiatCurrencyPill(props);
  const displayCurrency = useSettingsStore((state) => state.displayCurrency);

  // The pick-one surface is the picker sheet, the same one Select mint uses
  // (a pushed page on Android) — not an inline heroui Menu, which
  // mis-positions and paints at rest on Android.
  const openCurrencyMenu = useCallback(async () => {
    const picked = await pickOption({
      title: 'Display currency',
      options: CURRENCY_OPTIONS.map((option) => ({
        id: option.currency,
        title: option.label,
        leading: { node: <Icon name={option.icon} size={20} /> },
        testID: `fiat-currency-menu-${option.currency}`,
        // Match the native iOS UIMenu's stable row names while retaining the
        // friendlier long visual title and hint for Android screen readers.
        accessibilityLabel: option.currency.toUpperCase(),
        accessibilityHint: option.label,
        selected: option.currency === displayCurrency,
      })),
    });
    const option = CURRENCY_OPTIONS.find((candidate) => candidate.currency === picked);
    if (option) handleSelectCurrency(option.currency);
  }, [displayCurrency, handleSelectCurrency]);

  const { primaryHandler, longPressHandler } = handlersFor(() => void openCurrencyMenu());

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
