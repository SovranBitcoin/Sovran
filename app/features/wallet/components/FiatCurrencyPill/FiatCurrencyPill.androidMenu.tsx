import React, { useCallback } from 'react';

import Icon from 'assets/icons';
import { actionMenuPopup } from '@/shared/lib/popup/popups/actionMenu';
import { useSettingsStore, type DisplayCurrency } from '@/shared/stores/global/settingsStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useFiatCurrencyPill, type FiatCurrencyPillProps } from './useFiatCurrencyPill';
import { FiatPillShell, fiatPillHandlers } from './FiatCurrencyPill.shell';

const CURRENCY_OPTIONS: {
  currency: DisplayCurrency;
  label: string;
  icon: string;
}[] = [
  { currency: 'usd', label: 'US Dollar', icon: 'circle-flags:us' },
  { currency: 'eur', label: 'Euro', icon: 'circle-flags:eu' },
  { currency: 'gbp', label: 'British Pound', icon: 'circle-flags:gb' },
];

export function FiatCurrencyPillAndroidMenu(props: FiatCurrencyPillProps): React.ReactElement {
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
  const displayCurrency = useSettingsStore((state) => state.displayCurrency);
  const [success] = useThemeColor(['success'] as const);

  // The pick-one surface is the app-wide `actionMenuPopup()` bottom sheet
  // (rendered once by <ActionMenuHost /> at the app root) — not an inline
  // heroui Menu. Inline bottom-sheet menus mis-position / paint at rest on
  // Android; the global host opens fully and stays hidden when closed.
  const openCurrencyMenu = useCallback(() => {
    actionMenuPopup({
      title: 'Display currency',
      buttons: CURRENCY_OPTIONS.map((option) => ({
        text: option.label,
        iconNode: <Icon name={option.icon} size={20} />,
        testID: `fiat-currency-menu-${option.currency}`,
        // Match the native iOS UIMenu's stable row names while retaining the
        // friendlier long visual title and hint for Android screen readers.
        accessibilityLabel: option.currency.toUpperCase(),
        accessibilityHint: option.label,
        suffix:
          option.currency === displayCurrency ? (
            <Icon name="mdi:check" size={20} color={success} />
          ) : undefined,
        onPress: () => handleSelectCurrency(option.currency),
      })),
    });
  }, [displayCurrency, success, handleSelectCurrency]);

  const { primaryHandler, longPressHandler } = fiatPillHandlers(
    enableCurrencyMenu,
    onPress,
    openCurrencyMenu
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
