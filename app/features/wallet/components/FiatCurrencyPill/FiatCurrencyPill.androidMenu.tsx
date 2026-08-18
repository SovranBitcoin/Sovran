import React, { useCallback } from 'react';
import { withAlpha } from '@/shared/lib/color';

import Icon from 'assets/icons';
import { actionMenuPopup } from '@/shared/lib/popup/popups/actionMenu';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { useSettingsStore, type DisplayCurrency } from '@/shared/stores/global/settingsStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useFiatCurrencyPill, type FiatCurrencyPillProps } from './useFiatCurrencyPill';

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
  const [textColor, surfaceSecondary, muted] = useThemeColor([
    'foreground',
    'surface-secondary',
    'muted',
  ] as const);
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

  const renderPill = (primaryHandler?: () => void, longPressHandler?: () => void) => (
    <Pressable
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      disabled={!primaryHandler && !longPressHandler}
      onPress={primaryHandler}
      onLongPress={longPressHandler}>
      <HStack
        align="center"
        justify="center"
        gap={6}
        className="overflow-hidden rounded-full"
        style={{
          // The approved flat contract (CircleActionButton/BalancePill recipe);
          // these sit over the same wallet wallpaper as those buttons do.
          backgroundColor: surfaceSecondary,
          borderWidth: 1,
          borderColor: withAlpha(muted, 0.3),
          paddingHorizontal: 14,
          paddingVertical: 6,
          minHeight: iosHeight,
        }}>
        <Text overpass size={textSize} bold color={textColor} style={{ letterSpacing: 0.3 }}>
          {text}
        </Text>
      </HStack>
    </Pressable>
  );

  if (!enableCurrencyMenu) {
    return renderPill(onPress, undefined);
  }

  // With an external onPress, tap toggles sats/fiat and long-press opens the
  // currency menu; otherwise tap opens it. Mirrors useFiatCurrencyPill.
  return onPress ? renderPill(onPress, openCurrencyMenu) : renderPill(openCurrencyMenu, undefined);
}
