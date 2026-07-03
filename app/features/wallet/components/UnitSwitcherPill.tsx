import React, { useCallback } from 'react';

import Icon, { CurrencyIcon } from 'assets/icons';
import { actionMenuPopup } from '@/shared/lib/popup/popups/actionMenu';
import { CapsuleButton } from '@/shared/ui/composed/CapsuleButton';
import { StyleSheet } from 'react-native';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useActiveUnit } from '@/features/wallet/hooks/useActiveUnit';
import type { ActiveUnit } from '@/shared/stores/profile/mintStore';
import { walletLog } from '@/shared/lib/logger';

// Same icon language as the mint switcher's currency tabs: circle flags for
// fiat accounts, the branded bitcoin disc for sats.
const UNIT_OPTIONS: { unit: ActiveUnit; label: string; flagIcon?: string }[] = [
  { unit: 'sat', label: 'Bitcoin account' },
  { unit: 'usd', label: 'USD account', flagIcon: 'circle-flags:us' },
  { unit: 'eur', label: 'EUR account', flagIcon: 'circle-flags:eu' },
  { unit: 'gbp', label: 'GBP account', flagIcon: 'circle-flags:gb' },
];

function unitIconNode(option: (typeof UNIT_OPTIONS)[number], size: number): React.ReactNode {
  return option.flagIcon ? (
    <Icon name={option.flagIcon} size={size} />
  ) : (
    <CurrencyIcon width={size} currency={option.unit} />
  );
}

const PILL_LABELS: Record<ActiveUnit, string> = {
  sat: 'Bitcoin',
  usd: 'USD',
  eur: 'EUR',
  gbp: 'GBP',
};

// Matches FiatCurrencyPill's height — they stack in the same balance column.
const PILL_HEIGHT = 34;

/**
 * The wallet-unit switcher (coco v2 multi-unit): picks the unit the wallet
 * is DENOMINATED in — a different concept from the fiat display-currency
 * conversion pill, which only re-prices a sat balance. Opens the canonical
 * `actionMenuPopup` pick-one surface listing ONLY units some trusted mint
 * supports; with nothing to switch to, the pill itself is greyed out.
 * Picking a unit the preferred mint lacks also re-points the preferred mint
 * (see useActiveUnit.selectUnit).
 *
 * The pill face is the shared `CapsuleButton` — the same component behind
 * the ecash status pills — so it inherits every capability tier (liquid
 * glass / blur / flat) instead of hand-rolling a flat capsule.
 */
export function UnitSwitcherPill({
  textSize = 12,
  displayUnit,
}: {
  textSize?: number;
  /** Show THIS account on the pill (carousel pages preview their own unit);
   *  the menu still switches the ACTIVE unit. Defaults to the active unit. */
  displayUnit?: ActiveUnit;
}): React.ReactElement {
  const { unit, availableUnits, selectUnit } = useActiveUnit();
  const shownUnit = displayUnit ?? unit;
  const success = useThemeColor('success');
  const canSwitch = availableUnits.length > 1;

  const openUnitMenu = useCallback(() => {
    walletLog.info('wallet.unit.menu_open', { unit, available: availableUnits.join(',') });
    actionMenuPopup({
      title: 'Wallet accounts',
      buttons: UNIT_OPTIONS.filter((option) => availableUnits.includes(option.unit)).map(
        (option) => ({
          text: option.label,
          iconNode: unitIconNode(option, 22),
          testID: `wallet-unit-menu-${option.unit}`,
          suffix:
            option.unit === unit ? <Icon name="mdi:check" size={20} color={success} /> : undefined,
          onPress: () => selectUnit(option.unit),
        })
      ),
    });
  }, [unit, availableUnits, selectUnit, success]);

  const shownOption = UNIT_OPTIONS.find((o) => o.unit === shownUnit) ?? UNIT_OPTIONS[0];

  return (
    // Greyed out when only one unit exists — nothing to switch to.
    <View
      style={canSwitch ? undefined : styles.disabledSlot}
      pointerEvents={canSwitch ? 'auto' : 'none'}>
      <CapsuleButton
        label={PILL_LABELS[shownUnit]}
        iconNode={unitIconNode(shownOption, 16)}
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
