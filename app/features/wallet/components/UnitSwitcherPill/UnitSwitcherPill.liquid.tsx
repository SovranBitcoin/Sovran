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
 * Without the glass-button module (the liquid tier but no `LiquidGlassMenu`)
 * it renders the CapsuleButton fallback, whose accounts open in the app's own
 * picker sheet.
 *
 * Tap opens the menu; with one available unit the pill greys out and ignores
 * touches, matching the fallback tiers.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { LiquidGlassMenu } from 'liquid-glass-menu';
import { withAlpha } from '@/shared/lib/color';

import { View } from '@/shared/ui/primitives/View/View';
import { INVARIANT_WHITE } from '@/shared/lib/brandColors';
import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { unitSfSymbol } from '@/shared/lib/cashu/unitPresentation';
import type { ActiveUnit } from '@/shared/stores/profile/mintStore';
import {
  PILL_HEIGHT,
  pillLabel,
  useUnitSwitcherPill,
  type UnitSwitcherPillProps,
} from './useUnitSwitcherPill';
import { UnitSwitcherPillFallback } from './UnitSwitcherPill.fallback';

const MENU_TITLE = 'Wallet accounts';

export function UnitSwitcherPillLiquid(props: UnitSwitcherPillProps): React.ReactElement {
  if (!LiquidGlassMenu.isSupported) return <UnitSwitcherPillFallback {...props} />;
  return <UnitSwitcherPillGlass {...props} />;
}

function UnitSwitcherPillGlass(props: UnitSwitcherPillProps): React.ReactElement {
  const { unit, shownUnit, availableOptions, canSwitch, handleSelectUnit, textSize } =
    useUnitSwitcherPill(props);
  const colorScheme = useColorScheme();
  const textColor = useThemeColor('foreground');

  const label = pillLabel(shownUnit);

  // iOS 26: native glass button that morphs into its UIMenu and scrolls.
  // Native view needs an explicit frame — same sizing model as
  // useFiatCurrencyPill's iosWidth.
  const width = Math.max(72, Math.round(label.length * (textSize * 0.62) + 28));
  return (
    <View
      style={canSwitch ? undefined : styles.disabledSlot}
      pointerEvents={canSwitch ? 'auto' : 'none'}>
      <LiquidGlassMenu
        testID="wallet-unit-switcher"
        accessible
        accessibilityLabel="Switch wallet account"
        style={{ width, height: PILL_HEIGHT }}
        label={label}
        labelColor={textColor}
        labelSize={textSize}
        tint={withAlpha(INVARIANT_WHITE, 0.15)}
        colorScheme={colorScheme}
        menuTitle={MENU_TITLE}
        actions={availableOptions.map((option) => ({
          id: option.unit,
          title: option.label,
          image: unitSfSymbol(option.unit),
          selected: option.unit === unit,
        }))}
        onSelectAction={({ nativeEvent }) => handleSelectUnit(nativeEvent.id as ActiveUnit)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  disabledSlot: {
    opacity: 0.4,
  },
});
