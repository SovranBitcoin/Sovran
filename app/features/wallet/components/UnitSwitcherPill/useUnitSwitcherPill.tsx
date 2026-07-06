import React, { useCallback } from 'react';

import Icon, { CurrencyIcon } from 'assets/icons';
import { useActiveUnit } from '@/features/wallet/hooks/useActiveUnit';
import type { ActiveUnit } from '@/shared/stores/profile/mintStore';
import { walletLog } from '@/shared/lib/logger';

export interface UnitSwitcherPillProps {
  textSize?: number;
  /** Show THIS account on the pill (carousel pages preview their own unit);
   *  the menu still switches the ACTIVE unit. Defaults to the active unit. */
  displayUnit?: ActiveUnit;
}

interface UnitOption {
  unit: ActiveUnit;
  label: string;
  flagIcon?: string;
}

// Same icon language as the mint switcher's currency tabs: circle flags for
// fiat accounts, the branded bitcoin disc for sats.
const UNIT_OPTIONS: UnitOption[] = [
  { unit: 'sat', label: 'Bitcoin account' },
  { unit: 'usd', label: 'USD account', flagIcon: 'circle-flags:us' },
  { unit: 'eur', label: 'EUR account', flagIcon: 'circle-flags:eu' },
  { unit: 'gbp', label: 'GBP account', flagIcon: 'circle-flags:gb' },
];

/** SF Symbols for the native menu rows (LiquidGlassMenu / MenuView) — the
 *  same sign glyphs FiatCurrencyPill's native menu uses, plus bitcoin. */
export const UNIT_SF_SYMBOLS: Record<ActiveUnit, string> = {
  sat: 'bitcoinsign',
  usd: 'dollarsign',
  eur: 'eurosign',
  gbp: 'sterlingsign',
};

export function unitIconNode(option: UnitOption, size: number): React.ReactNode {
  return option.flagIcon ? (
    <Icon name={option.flagIcon} size={size} />
  ) : (
    <CurrencyIcon width={size} currency={option.unit} />
  );
}

export const PILL_LABELS: Record<ActiveUnit, string> = {
  sat: 'Bitcoin',
  usd: 'USD',
  eur: 'EUR',
  gbp: 'GBP',
};

// Matches FiatCurrencyPill's height — they stack in the same balance column.
export const PILL_HEIGHT = 34;

interface UnitSwitcherPillShared {
  /** The ACTIVE wallet unit (what the menu marks selected / switches). */
  unit: ActiveUnit;
  /** The unit shown on the pill face (a carousel page's own account). */
  shownUnit: ActiveUnit;
  shownOption: UnitOption;
  /** Unit options some trusted mint actually supports, in menu order. */
  availableOptions: UnitOption[];
  /** False when only one unit exists — the pill greys out, nothing to pick. */
  canSwitch: boolean;
  handleSelectUnit: (unit: ActiveUnit) => void;
  textSize: number;
}

export function useUnitSwitcherPill({
  textSize = 12,
  displayUnit,
}: UnitSwitcherPillProps): UnitSwitcherPillShared {
  const { unit, availableUnits, selectUnit } = useActiveUnit();
  const shownUnit = displayUnit ?? unit;
  const canSwitch = availableUnits.length > 1;

  const handleSelectUnit = useCallback(
    (next: ActiveUnit) => {
      walletLog.info('wallet.unit.menu_selected', { from: unit, to: next });
      selectUnit(next);
    },
    [unit, selectUnit]
  );

  const availableOptions = UNIT_OPTIONS.filter((option) => availableUnits.includes(option.unit));
  const shownOption = UNIT_OPTIONS.find((o) => o.unit === shownUnit) ?? UNIT_OPTIONS[0];

  return {
    unit,
    shownUnit,
    shownOption,
    availableOptions,
    canSwitch,
    handleSelectUnit,
    textSize,
  };
}
