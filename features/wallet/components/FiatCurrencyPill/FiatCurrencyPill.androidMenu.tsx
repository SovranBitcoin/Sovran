import React, { useRef } from 'react';
import { Menu, type MenuTriggerRef } from 'heroui-native';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { MenuScrim } from '@/shared/blocks/popup/MenuScrim';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
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
  const { text, iosHeight, handleSelectCurrency, onPress, enableCurrencyMenu, textSize } =
    useFiatCurrencyPill(props);
  const displayCurrency = useSettingsStore((state) => state.displayCurrency);
  const [textColor, surfaceSecondary, muted] = useThemeColor([
    'foreground',
    'surface-secondary',
    'muted',
  ] as const);
  const [success] = useThemeColor(['success'] as const);
  const menuTriggerRef = useRef<MenuTriggerRef>(null);

  const openCurrencyMenu = () => {
    setTimeout(() => menuTriggerRef.current?.open(), 0);
  };

  const primaryHandler = enableCurrencyMenu && !onPress ? openCurrencyMenu : onPress;
  const longPressHandler = enableCurrencyMenu && onPress ? openCurrencyMenu : undefined;

  const pill = (
    <Pressable
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
          borderColor: opacity(muted, 0.3),
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
    return pill;
  }

  return (
    <Menu presentation="bottom-sheet">
      <Menu.Trigger
        ref={menuTriggerRef}
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}>
        <View style={{ width: 1, height: 1 }} />
      </Menu.Trigger>
      {pill}
      <Menu.Portal disableFullWindowOverlay>
        <MenuScrim />
        <Menu.Content presentation="bottom-sheet">
          <Menu.Label className="text-foreground -mt-2 mb-2 ml-3 text-lg font-bold">
            Display currency
          </Menu.Label>
          {CURRENCY_OPTIONS.map((option) => {
            const isSelected = option.currency === displayCurrency;
            return (
              <Menu.Item
                key={option.currency}
                testID={`fiat-currency-menu-${option.currency}`}
                onPress={() => handleSelectCurrency(option.currency)}>
                <HStack align="center" gap={10} style={{ flex: 1 }}>
                  <Icon name={option.icon} size={20} />
                  <View style={{ flex: 1 }}>
                    <Menu.ItemTitle>{option.label}</Menu.ItemTitle>
                  </View>
                  {isSelected ? <Icon name="mdi:check" size={20} color={success} /> : null}
                </HStack>
              </Menu.Item>
            );
          })}
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  );
}
