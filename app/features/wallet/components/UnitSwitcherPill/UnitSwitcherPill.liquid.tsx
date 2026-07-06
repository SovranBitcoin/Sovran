/**
 * iOS Liquid Glass variant — the same recipe as FiatCurrencyPill.liquid (the
 * two pills stack in the same balance column and must match).
 *
 * Preferred path (iOS 26): a native UIKit glass button + UIMenu via the local
 * `liquid-glass-menu` module. Being plain UIKit (not a SwiftUI Host) it
 * scrolls with the list instead of pinning to the top (expo/expo#46278), and
 * a `.glass()` button morphs into its menu. The face is text-only ("Bitcoin",
 * "USD", …) — matching FiatCurrencyPill; the menu rows keep their SF sign
 * glyphs.
 *
 * Fallback (no glass-button morph available): an expo-glass-effect GlassView
 * capsule (also a real RN view, so it scrolls) wearing a native iOS menu via
 * @react-native-menu/menu's MenuView. Native menu + correct scroll, just no
 * glass morph.
 *
 * Tap opens the menu on both paths; with one available unit the pill greys
 * out and ignores touches, matching the fallback tiers.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { MenuView, type MenuAction } from '@react-native-menu/menu';
import { GlassView } from 'expo-glass-effect';
import { LiquidGlassMenu } from 'liquid-glass-menu';
import opacity from 'hex-color-opacity';

import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { INVARIANT_WHITE } from '@/shared/lib/brandColors';
import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import type { ActiveUnit } from '@/shared/stores/profile/mintStore';
import {
  PILL_HEIGHT,
  PILL_LABELS,
  UNIT_SF_SYMBOLS,
  useUnitSwitcherPill,
  type UnitSwitcherPillProps,
} from './useUnitSwitcherPill';

const MENU_TITLE = 'Wallet accounts';

export function UnitSwitcherPillLiquid(props: UnitSwitcherPillProps): React.ReactElement {
  const { unit, shownUnit, availableOptions, canSwitch, handleSelectUnit, textSize } =
    useUnitSwitcherPill(props);
  const colorScheme = useColorScheme();
  const textColor = useThemeColor('foreground');

  const label = PILL_LABELS[shownUnit];

  // iOS 26: native glass button that morphs into its UIMenu and scrolls.
  if (LiquidGlassMenu.isSupported) {
    // Native view needs an explicit frame — same sizing model as
    // useFiatCurrencyPill's iosWidth.
    const width = Math.max(72, Math.round(label.length * (textSize * 0.62) + 28));
    return (
      <View
        style={canSwitch ? undefined : styles.disabledSlot}
        pointerEvents={canSwitch ? 'auto' : 'none'}>
        <LiquidGlassMenu
          testID="wallet-unit-switcher"
          style={{ width, height: PILL_HEIGHT }}
          label={label}
          labelColor={textColor}
          labelSize={textSize}
          tint={opacity(INVARIANT_WHITE, 0.15)}
          colorScheme={colorScheme}
          menuTitle={MENU_TITLE}
          actions={availableOptions.map((option) => ({
            id: option.unit,
            title: option.label,
            image: UNIT_SF_SYMBOLS[option.unit],
            selected: option.unit === unit,
          }))}
          onSelectAction={({ nativeEvent }) => handleSelectUnit(nativeEvent.id as ActiveUnit)}
        />
      </View>
    );
  }

  // Fallback: GlassView pill + native UIMenu via MenuView (scrolls, no morph).
  const actions: MenuAction[] = availableOptions.map((option) => ({
    id: option.unit,
    title: option.label,
    image: UNIT_SF_SYMBOLS[option.unit],
    state: option.unit === unit ? ('on' as const) : ('off' as const),
  }));

  const pill = (
    <GlassView
      glassEffectStyle="regular"
      // NOT `isInteractive`: on iOS 26 the interactive glass layer contends for
      // touches with the wrapping MenuView, making taps flaky. Keep the glass
      // decorative; the menu owns the tap.
      tintColor={opacity(INVARIANT_WHITE, 0.15)}
      style={styles.glassPill}>
      <Text overpass size={textSize} bold color={textColor} style={styles.pillText}>
        {label}
      </Text>
    </GlassView>
  );

  return (
    <View
      testID="wallet-unit-switcher"
      style={canSwitch ? undefined : styles.disabledSlot}
      pointerEvents={canSwitch ? 'auto' : 'none'}>
      <MenuView
        title={MENU_TITLE}
        actions={actions}
        onPressAction={({ nativeEvent }) => handleSelectUnit(nativeEvent.event as ActiveUnit)}>
        {pill}
      </MenuView>
    </View>
  );
}

const styles = StyleSheet.create({
  disabledSlot: {
    opacity: 0.4,
  },
  glassPill: {
    borderRadius: 999,
    overflow: 'hidden',
    minHeight: PILL_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  pillText: {
    letterSpacing: 0.3,
  },
});
