/**
 * Fallback tiers (iOS blur/flat + Android): the shared `CapsuleButton` face —
 * the same component behind the ecash status pills, which tiers itself
 * (blur/flat). The shared action-menu sheet also presents above native route
 * modals. Header callers use the canonical circular header action instead.
 */

import React, { useCallback } from 'react';
import { StyleSheet } from 'react-native';

import Icon from 'assets/icons';
import { actionMenuSheet } from '@/shared/lib/popup/popups/actionMenuSheet';
import { CapsuleButton } from '@/shared/ui/composed/CapsuleButton';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import {
  PILL_HEIGHT,
  PILL_LABELS,
  unitIconNode,
  useUnitSwitcherPill,
  type UnitSwitcherPillProps,
} from './useUnitSwitcherPill';

export function UnitSwitcherPillFallback(
  props: UnitSwitcherPillProps & { header?: boolean }
): React.ReactElement {
  const { unit, shownUnit, shownOption, availableOptions, canSwitch, handleSelectUnit, textSize } =
    useUnitSwitcherPill(props);
  const selectedUnit = props.header ? shownUnit : unit;
  const success = useThemeColor('success');

  const openUnitMenu = useCallback(() => {
    actionMenuSheet({
      title: 'Wallet accounts',
      buttons: availableOptions.map((option) => ({
        text: option.label,
        iconNode: unitIconNode(option, 22),
        testID: `wallet-unit-menu-${option.unit}`,
        suffix:
          option.unit === selectedUnit ? (
            <Icon name="mdi:check" size={20} color={success} />
          ) : undefined,
        onPress: () => handleSelectUnit(option.unit),
      })),
    });
  }, [selectedUnit, availableOptions, handleSelectUnit, success]);

  if (props.header) {
    return (
      <ScreenHeaderAction
        onPress={openUnitMenu}
        testID="wallet-unit-switcher"
        accessibilityLabel={`Switch wallet account, ${PILL_LABELS[shownUnit]}`}>
        {unitIconNode(shownOption, 24)}
      </ScreenHeaderAction>
    );
  }

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
