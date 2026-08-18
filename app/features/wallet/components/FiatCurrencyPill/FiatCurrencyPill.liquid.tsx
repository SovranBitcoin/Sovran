/**
 * iOS Liquid Glass variant.
 *
 * Preferred path (iOS 26): a native UIKit glass button + UIMenu via the local
 * `liquid-glass-menu` module. Being plain UIKit (not a SwiftUI Host) it scrolls
 * with the list instead of pinning to the top (expo/expo#46278), and a
 * `.glass()` button morphs into its menu — reproducing the Liquid Glass
 * context-menu animation the old SwiftUI Menu had, without the scroll-pin.
 *
 * Fallback (no glass-button morph available): an expo-glass-effect GlassView
 * capsule (also a real RN view, so it scrolls) wearing a native iOS menu via
 * @react-native-menu/menu's MenuView. Native menu + correct scroll, just no
 * glass morph.
 *
 * Tap/long-press contract mirrors the blur + android variants: when an `onPress`
 * toggle exists, a tap fires it and a long-press opens the menu; with no
 * `onPress`, a tap opens the menu.
 */

import React from 'react';
import { MenuView, type MenuAction } from '@react-native-menu/menu';
import { GlassView } from 'expo-glass-effect';
import { LiquidGlassMenu } from 'liquid-glass-menu';
import { withAlpha } from '@/shared/lib/color';

import { Text } from '@/shared/ui/primitives/Text';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { INVARIANT_WHITE } from '@/shared/lib/brandColors';
import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useSettingsStore, type DisplayCurrency } from '@/shared/stores/global/settingsStore';
import { useFiatCurrencyPill, type FiatCurrencyPillProps } from './useFiatCurrencyPill';

export function FiatCurrencyPillLiquid(props: FiatCurrencyPillProps): React.ReactElement {
  const {
    text,
    iosHeight,
    iosWidth,
    handleSelectCurrency,
    onPress,
    enableCurrencyMenu,
    textSize,
    testID,
    accessibilityLabel,
  } = useFiatCurrencyPill(props);
  const colorScheme = useColorScheme();
  const textColor = useThemeColor('foreground');
  const displayCurrency = useSettingsStore((state) => state.displayCurrency);

  // iOS 26: native glass button that morphs into its UIMenu and scrolls.
  if (enableCurrencyMenu && LiquidGlassMenu.isSupported) {
    return (
      <LiquidGlassMenu
        style={{ width: iosWidth, height: iosHeight }}
        testID={testID}
        accessible={!!accessibilityLabel}
        accessibilityLabel={accessibilityLabel}
        label={text}
        labelColor={textColor}
        labelSize={textSize}
        tint={withAlpha(INVARIANT_WHITE, 0.15)}
        colorScheme={colorScheme}
        menuTitle="Display currency"
        hasPrimaryAction={!!onPress}
        actions={[
          { id: 'usd', title: 'USD', image: 'dollarsign', selected: displayCurrency === 'usd' },
          { id: 'eur', title: 'EUR', image: 'eurosign', selected: displayCurrency === 'eur' },
          { id: 'gbp', title: 'GBP', image: 'sterlingsign', selected: displayCurrency === 'gbp' },
        ]}
        onSelectAction={({ nativeEvent }) =>
          handleSelectCurrency(nativeEvent.id as DisplayCurrency)
        }
        onPrimaryPress={() => onPress?.()}
      />
    );
  }

  // Fallback: GlassView pill + native UIMenu via MenuView (scrolls, no morph).
  const actions: MenuAction[] = [
    {
      id: 'usd',
      title: 'USD',
      image: 'dollarsign',
      state: displayCurrency === 'usd' ? 'on' : 'off',
    },
    { id: 'eur', title: 'EUR', image: 'eurosign', state: displayCurrency === 'eur' ? 'on' : 'off' },
    {
      id: 'gbp',
      title: 'GBP',
      image: 'sterlingsign',
      state: displayCurrency === 'gbp' ? 'on' : 'off',
    },
  ];

  const pill = (
    <GlassView
      glassEffectStyle="regular"
      testID={testID}
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      // NOT `isInteractive`: on iOS 26 the interactive glass layer contends for
      // touches with the wrapping Pressable/MenuView, making taps flaky. Keep
      // the glass decorative; the pressable/menu owns the tap.
      tintColor={withAlpha(INVARIANT_WHITE, 0.15)}
      style={{
        borderRadius: 999,
        overflow: 'hidden',
        minHeight: iosHeight,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 14,
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
    <MenuView
      title="Display currency"
      actions={actions}
      shouldOpenOnLongPress={!!onPress}
      onPressAction={({ nativeEvent }) =>
        handleSelectCurrency(nativeEvent.event as DisplayCurrency)
      }>
      {onPress ? <Pressable onPress={onPress}>{pill}</Pressable> : pill}
    </MenuView>
  );
}
