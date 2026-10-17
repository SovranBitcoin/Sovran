/**
 * Fallback tiers (iOS blur/flat + Android): the shared `CapsuleButton` face —
 * the same component behind the ecash status pills, which tiers itself
 * (blur/flat). The accounts open in the picker sheet, which also presents
 * over native route modals. Header callers use the canonical circular header action instead.
 */

import React, { useCallback } from 'react';
import { StyleSheet } from 'react-native';

import Icon from 'assets/icons';
import { pickOption } from '@/shared/lib/picker/openPicker';
import { CapsuleButton } from '@/shared/ui/composed/CapsuleButton';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { View } from '@/shared/ui/primitives/View/View';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import {
  PILL_HEIGHT,
  pillLabel,
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
  const paint = useStylePaint();

  const openUnitMenu = useCallback(async () => {
    const picked = await pickOption({
      title: 'Wallet accounts',
      options: availableOptions.map((option) => ({
        id: option.unit,
        title: option.label,
        leading: { node: unitIconNode(option, 22) },
        testID: `wallet-unit-menu-${option.unit}`,
        selected: option.unit === selectedUnit,
      })),
    });
    const option = availableOptions.find((candidate) => candidate.unit === picked);
    if (option) handleSelectUnit(option.unit);
  }, [selectedUnit, availableOptions, handleSelectUnit]);
  const openUnitSheet = () => void openUnitMenu();

  if (props.header) {
    return (
      <ScreenHeaderAction
        onPress={openUnitSheet}
        testID="wallet-unit-switcher"
        accessibilityLabel={`Switch wallet account, ${pillLabel(shownUnit)}`}>
        {unitIconNode(shownOption, 24)}
      </ScreenHeaderAction>
    );
  }

  // Outside the glass style the account is a label over the balance: plain
  // secondary type, with a chevron only when there is another account to
  // switch to. With one account it is a caption, not a disabled control.
  if (paint.style.surface !== 'glass') {
    const label = paint.style.type.uppercaseLabels
      ? shownOption.label.toUpperCase()
      : shownOption.label;
    return (
      <Pressable
        testID="wallet-unit-switcher"
        accessibilityRole="button"
        accessibilityLabel="Switch wallet account"
        accessibilityState={{ disabled: !canSwitch }}
        disabled={!canSwitch}
        hitSlop={BARE_HIT_SLOP}
        onPress={openUnitSheet}
        style={styles.bare}>
        <Text medium size={14} family={paint.style.type.family} color={paint.text.secondary}>
          {label}
        </Text>
        {canSwitch ? <Icon name="mdi:chevron-down" size={16} color={paint.text.secondary} /> : null}
      </Pressable>
    );
  }

  return (
    // Greyed out when only one unit exists — nothing to switch to.
    <View
      style={canSwitch ? undefined : styles.disabledSlot}
      pointerEvents={canSwitch ? 'auto' : 'none'}>
      <CapsuleButton
        label={pillLabel(shownUnit)}
        // Matches the liquid tier's spoken name — the visible "SATS"/"USD"
        // abbreviation does not stand alone.
        accessibilityLabel="Switch wallet account"
        onPress={openUnitSheet}
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

const BARE_HIT_SLOP = { top: 16, bottom: 12, left: 24, right: 24 };

const styles = StyleSheet.create({
  bare: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
  },
  disabledSlot: {
    opacity: 0.4,
  },
  pillText: {
    letterSpacing: 0.3,
  },
});
