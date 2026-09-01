/**
 * Fallback tiers (iOS blur/flat + Android): the shared `CapsuleButton` face —
 * the same component behind the ecash status pills, which tiers itself
 * (blur/flat) — opening the app-wide `actionMenuPopup()` bottom sheet
 * (rendered once by <ActionMenuHost /> at the app root). Inline menus
 * mis-position on Android; the global host opens fully and stays hidden
 * when closed.
 */

import React, { useCallback } from 'react';
import { StyleSheet } from 'react-native';

import Icon from 'assets/icons';
import { actionMenuPopup } from '@/shared/lib/popup/popups/actionMenu';
import { CapsuleButton } from '@/shared/ui/composed/CapsuleButton';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import {
  PILL_HEIGHT,
  PILL_LABELS,
  unitIconNode,
  useUnitSwitcherPill,
  type UnitSwitcherPillProps,
} from './useUnitSwitcherPill';

export function UnitSwitcherPillFallback(props: UnitSwitcherPillProps): React.ReactElement {
  const { unit, shownUnit, availableOptions, canSwitch, handleSelectUnit, textSize } =
    useUnitSwitcherPill(props);
  const success = useThemeColor('success');

  const openUnitMenu = useCallback(() => {
    actionMenuPopup({
      title: 'Wallet accounts',
      buttons: availableOptions.map((option) => ({
        text: option.label,
        iconNode: unitIconNode(option, 22),
        testID: `wallet-unit-menu-${option.unit}`,
        suffix:
          option.unit === unit ? <Icon name="mdi:check" size={20} color={success} /> : undefined,
        onPress: () => handleSelectUnit(option.unit),
      })),
    });
  }, [unit, availableOptions, handleSelectUnit, success]);

  return (
    // Greyed out when only one unit exists — nothing to switch to.
    <View
      style={canSwitch ? undefined : styles.disabledSlot}
      pointerEvents={canSwitch ? 'auto' : 'none'}>
      <CapsuleButton
        label={PILL_LABELS[shownUnit]}
        // Matches the liquid tier's spoken name — the visible "SATS"/"USD"
        // abbreviation does not stand alone.
        accessibilityLabel="Switch wallet account"
        onPress={openUnitMenu}
        height={PILL_HEIGHT}
        fitContent
        textSize={textSize}
        labelNumberOfLines={1}
        textStyle={styles.pillText}
        testID="wallet-unit-switcher"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  disabledSlot: {
    opacity: 0.4,
  },
  pillText: {
    letterSpacing: 0.3,
  },
});
