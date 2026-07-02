import React, { useCallback } from 'react';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { actionMenuPopup } from '@/shared/lib/popup/popups/actionMenu';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useActiveUnit } from '@/features/wallet/hooks/useActiveUnit';
import type { ActiveUnit } from '@/shared/stores/profile/mintStore';
import { walletLog } from '@/shared/lib/logger';

const UNIT_OPTIONS: { unit: ActiveUnit; label: string; icon: string }[] = [
  { unit: 'sat', label: 'Sats', icon: 'ph:coins' },
  { unit: 'usd', label: 'US Dollar ecash', icon: 'circle-flags:us' },
  { unit: 'eur', label: 'Euro ecash', icon: 'circle-flags:eu' },
  { unit: 'gbp', label: 'British Pound ecash', icon: 'circle-flags:gb' },
];

/**
 * The wallet-unit switcher (coco v2 multi-unit): picks the unit the wallet
 * is DENOMINATED in — a different concept from the fiat display-currency
 * conversion pill, which only re-prices a sat balance. Opens the canonical
 * `actionMenuPopup` pick-one surface listing ONLY units some trusted mint
 * supports; with nothing to switch to, the pill itself is greyed out.
 * Picking a unit the preferred mint lacks also re-points the preferred mint
 * (see useActiveUnit.selectUnit).
 */
export function UnitSwitcherPill({ textSize = 12 }: { textSize?: number }): React.ReactElement {
  const { unit, availableUnits, selectUnit } = useActiveUnit();
  const [textColor, surfaceSecondary, muted, success] = useThemeColor([
    'foreground',
    'surface-secondary',
    'muted',
    'success',
  ] as const);
  const canSwitch = availableUnits.length > 1;

  const openUnitMenu = useCallback(() => {
    walletLog.info('wallet.unit.menu_open', { unit, available: availableUnits.join(',') });
    actionMenuPopup({
      title: 'Wallet unit',
      buttons: UNIT_OPTIONS.filter((option) => availableUnits.includes(option.unit)).map(
        (option) => ({
          text: option.label,
          iconNode: <Icon name={option.icon} size={20} />,
          testID: `wallet-unit-menu-${option.unit}`,
          suffix:
            option.unit === unit ? <Icon name="mdi:check" size={20} color={success} /> : undefined,
          onPress: () => selectUnit(option.unit),
        })
      ),
    });
  }, [unit, availableUnits, selectUnit, success]);

  return (
    <Pressable
      onPress={canSwitch ? openUnitMenu : undefined}
      disabled={!canSwitch}
      testID="wallet-unit-switcher">
      <HStack
        align="center"
        justify="center"
        gap={6}
        className="overflow-hidden rounded-full"
        style={{
          // Same flat pill contract as FiatCurrencyPill — they share the row.
          backgroundColor: surfaceSecondary,
          borderWidth: 1,
          borderColor: opacity(muted, 0.3),
          paddingHorizontal: 14,
          paddingVertical: 6,
          // Greyed out when only one unit exists — nothing to switch to.
          opacity: canSwitch ? 1 : 0.4,
        }}>
        <Text
          overpass
          size={textSize}
          bold
          color={canSwitch ? textColor : muted}
          style={{ letterSpacing: 0.3 }}>
          {unit.toUpperCase()}
        </Text>
      </HStack>
    </Pressable>
  );
}
