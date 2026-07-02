import React, { useCallback } from 'react';
import opacity from 'hex-color-opacity';

import Icon, { CurrencyIcon } from 'assets/icons';
import { actionMenuPopup } from '@/shared/lib/popup/popups/actionMenu';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useActiveUnit } from '@/features/wallet/hooks/useActiveUnit';
import type { ActiveUnit } from '@/shared/stores/profile/mintStore';
import { walletLog } from '@/shared/lib/logger';

const UNIT_OPTIONS: { unit: ActiveUnit; label: string }[] = [
  { unit: 'sat', label: 'Bitcoin account' },
  { unit: 'usd', label: 'USD account' },
  { unit: 'eur', label: 'EUR account' },
  { unit: 'gbp', label: 'GBP account' },
];

const PILL_LABELS: Record<ActiveUnit, string> = {
  sat: 'Bitcoin',
  usd: 'USD',
  eur: 'EUR',
  gbp: 'GBP',
};

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
      title: 'Wallet accounts',
      buttons: UNIT_OPTIONS.filter((option) => availableUnits.includes(option.unit)).map(
        (option) => ({
          text: option.label,
          // The branded currency disc used everywhere else in the app (the
          // bitcoin disc stays orange with a white B).
          iconNode: <CurrencyIcon width={22} currency={option.unit} />,
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
        <CurrencyIcon width={16} currency={unit} />
        <Text
          overpass
          size={textSize}
          bold
          color={canSwitch ? textColor : muted}
          style={{ letterSpacing: 0.3 }}>
          {PILL_LABELS[unit]}
        </Text>
      </HStack>
    </Pressable>
  );
}
