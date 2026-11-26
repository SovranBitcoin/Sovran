/**
 * iOS Liquid Glass variant.
 *
 * Preferred path (iOS 26): a native UIKit glass button + UIMenu via the local
 * `liquid-glass-menu` module. Being plain UIKit (not a SwiftUI Host) it scrolls
 * with the list instead of pinning to the top (expo/expo#46278), and a
 * `.glass()` button morphs into its menu — reproducing the Liquid Glass
 * context-menu animation the old SwiftUI Menu had, without the scroll-pin.
 *
 * Without the glass-button module the flat variant draws the pill (the same
 * pill the other styles draw) and its currency menu.
 *
 * Tap/long-press contract mirrors the blur + android variants: when an `onPress`
 * toggle exists, a tap fires it and a long-press opens the menu; with no
 * `onPress`, a tap opens the menu.
 */

import { accountUnitLabel, FIAT_UNITS } from 'wallet';

import { unitSfSymbol } from '@/shared/lib/cashu/unitPresentation';
import React from 'react';
import { LiquidGlassMenu } from 'liquid-glass-menu';
import { withAlpha } from '@/shared/lib/color';

import { INVARIANT_WHITE } from '@/shared/lib/brandColors';
import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useSettingsStore, type DisplayCurrency } from '@/shared/stores/global/settingsStore';
import { FiatCurrencyPillFlat } from './FiatCurrencyPill.flat';
import { useFiatCurrencyPill, type FiatCurrencyPillProps } from './useFiatCurrencyPill';

export function FiatCurrencyPillLiquid(props: FiatCurrencyPillProps): React.ReactElement {
  if (!LiquidGlassMenu.isSupported) return <FiatCurrencyPillFlat {...props} />;
  return <FiatCurrencyPillGlass {...props} />;
}

function FiatCurrencyPillGlass(props: FiatCurrencyPillProps): React.ReactElement {
  const {
    text,
    iosHeight,
    iosWidth,
    handleSelectCurrency,
    onPress,
    menuOpensOnLongPress,
    textSize,
    testID,
    accessibilityLabel,
  } = useFiatCurrencyPill(props);
  const colorScheme = useColorScheme();
  const textColor = useThemeColor('foreground');
  const displayCurrency = useSettingsStore((state) => state.displayCurrency);

  // iOS 26: native glass button that morphs into its UIMenu and scrolls.
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
      hasPrimaryAction={menuOpensOnLongPress}
      actions={FIAT_UNITS.map((unit) => ({
        id: unit,
        title: accountUnitLabel(unit),
        image: unitSfSymbol(unit),
        selected: displayCurrency === unit,
      }))}
      onSelectAction={({ nativeEvent }) => handleSelectCurrency(nativeEvent.id as DisplayCurrency)}
      onPrimaryPress={() => onPress?.()}
    />
  );
}
