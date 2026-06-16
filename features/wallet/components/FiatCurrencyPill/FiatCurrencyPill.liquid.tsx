/**
 * iOS 26+ Liquid Glass variant: a glass capsule via expo-glass-effect's
 * GlassView (a UIVisualEffectView-backed React Native view). We deliberately do
 * NOT use an @expo/ui SwiftUI `Host`: Host views (UIHostingController) don't
 * follow an RN ScrollView's content transform and visually pin to the top while
 * scrolling (expo/expo#46278). GlassView scrolls like any RN view.
 *
 * Currency selection uses heroui-native's anchored popover Menu (a real RN
 * context menu) so it stays a tap-anchored menu — not a bottom sheet — while
 * the trigger pill remains a plain scrollable view.
 */

import React from 'react';
import opacity from 'hex-color-opacity';

import { GlassView } from 'expo-glass-effect';
import { Menu } from 'heroui-native';

import { Text } from '@/shared/ui/primitives/Text';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { MenuScrim } from '@/shared/blocks/popup/MenuScrim';
import { INVARIANT_WHITE } from '@/shared/lib/brandColors';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { DisplayCurrency } from '@/shared/stores/global/settingsStore';
import { useFiatCurrencyPill, type FiatCurrencyPillProps } from './useFiatCurrencyPill';

const CURRENCY_OPTIONS: { code: DisplayCurrency; label: string }[] = [
  { code: 'usd', label: 'USD' },
  { code: 'eur', label: 'EUR' },
  { code: 'gbp', label: 'GBP' },
];

export function FiatCurrencyPillLiquid(props: FiatCurrencyPillProps): React.ReactElement {
  const { text, iosHeight, handleSelectCurrency, onPress, enableCurrencyMenu, textSize } =
    useFiatCurrencyPill(props);
  const textColor = useThemeColor('foreground');

  const pill = (
    <GlassView
      glassEffectStyle="regular"
      isInteractive
      tintColor={opacity(INVARIANT_WHITE, 0.15)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderRadius: 999,
        paddingHorizontal: 14,
        minHeight: iosHeight,
      }}>
      <Text overpass size={textSize} bold color={textColor} style={{ letterSpacing: 0.3 }}>
        {text}
      </Text>
    </GlassView>
  );

  if (!enableCurrencyMenu) {
    return (
      <Pressable onPress={onPress} disabled={!onPress}>
        {pill}
      </Pressable>
    );
  }

  return (
    <Menu presentation="popover">
      <Menu.Trigger>{pill}</Menu.Trigger>
      <Menu.Portal>
        <MenuScrim />
        <Menu.Content presentation="popover">
          {CURRENCY_OPTIONS.map((option) => (
            <Menu.Item key={option.code} onPress={() => handleSelectCurrency(option.code)}>
              <Menu.ItemTitle>{option.label}</Menu.ItemTitle>
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  );
}
