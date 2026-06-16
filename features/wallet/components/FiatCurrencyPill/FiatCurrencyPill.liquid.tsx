/**
 * iOS Liquid Glass variant: an expo-glass-effect GlassView capsule (a real
 * UIVisualEffectView-backed RN view, so it scrolls with the list) wearing a
 * NATIVE iOS context menu via @react-native-menu/menu's MenuView (a real
 * UIMenu).
 *
 * This deliberately avoids the @expo/ui SwiftUI `Host`: Host views render via a
 * UIHostingController that does NOT follow an RN ScrollView's content transform,
 * so they visually pin to the top while scrolling (expo/expo#46278). MenuView +
 * GlassView are ordinary RN views and track the scroll, while still presenting
 * the exact native iOS menu look/feel/perf.
 *
 * Tap/long-press contract mirrors the blur + android variants: when an `onPress`
 * toggle exists, a tap fires it and a long-press opens the menu; with no
 * `onPress`, a tap opens the menu.
 */

import React from 'react';
import { MenuView, type MenuAction } from '@react-native-menu/menu';
import { GlassView } from 'expo-glass-effect';
import opacity from 'hex-color-opacity';

import { Text } from '@/shared/ui/primitives/Text';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { INVARIANT_WHITE } from '@/shared/lib/brandColors';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useSettingsStore, type DisplayCurrency } from '@/shared/stores/global/settingsStore';
import { useFiatCurrencyPill, type FiatCurrencyPillProps } from './useFiatCurrencyPill';

export function FiatCurrencyPillLiquid(props: FiatCurrencyPillProps): React.ReactElement {
  const { text, iosHeight, handleSelectCurrency, onPress, enableCurrencyMenu, textSize } =
    useFiatCurrencyPill(props);
  const textColor = useThemeColor('foreground');
  const displayCurrency = useSettingsStore((state) => state.displayCurrency);

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
      isInteractive
      tintColor={opacity(INVARIANT_WHITE, 0.15)}
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
