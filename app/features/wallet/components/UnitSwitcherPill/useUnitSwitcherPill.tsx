import React, { useCallback } from 'react';

import Icon, { CurrencyIcon } from 'assets/icons';
import { ACCOUNT_UNITS, accountUnitLabel, accountUnitName, toRealUnit } from 'wallet';
import { unitFlagIcon, unitName } from '@/shared/lib/cashu/unitPresentation';
import { useWalletPresentationUnit } from '@/features/wallet/hooks/useWalletPresentationUnit';
import type { ActiveUnit } from '@/shared/stores/profile/mintStore';
import { walletLog } from '@/shared/lib/logger';

export interface UnitSwitcherPillProps {
  /** Only wallet display pages opt into the isolated Mock Mode currency list. */
  presentation?: boolean;
  textSize?: number;
  /** Show THIS account on the pill (carousel pages preview their own unit);
   *  the menu still switches the ACTIVE unit. Defaults to the active unit. */
  displayUnit?: ActiveUnit;
  /** Override selection when a screen must coordinate its current flow. */
  onSelectUnit?: (unit: ActiveUnit) => void;
}

interface UnitOption {
  unit: ActiveUnit;
  label: string;
  flagIcon?: string;
}

// Every account the wallet knows, in registry order (real, then testnut —
// the same unit at a mint with a fake payment backend, kept apart so test funds
// never mix with real ones). Same icon language as the mint switcher's currency
// tabs: circle flags for fiat accounts, the branded bitcoin disc for sats.
const UNIT_OPTIONS: UnitOption[] = ACCOUNT_UNITS.map((unit) => ({
  unit,
  label: accountUnitName(unit),
  flagIcon: unitFlagIcon(unit),
}));

export function unitIconNode(option: UnitOption, size: number): React.ReactNode {
  return option.flagIcon ? (
    <Icon name={option.flagIcon} size={size} />
  ) : (
    <CurrencyIcon width={size} currency={toRealUnit(option.unit)} />
  );
}

/** Pill face: the Bitcoin account reads by name, every other by its code. */
export function pillLabel(unit: ActiveUnit): string {
  return unit === 'sat' ? unitName(unit) : accountUnitLabel(unit);
}

// Matches FiatCurrencyPill's height — they stack in the same balance column.
export const PILL_HEIGHT = 34;

interface UnitSwitcherPillShared {
  /** The ACTIVE wallet unit (what the menu marks selected / switches). */
  unit: ActiveUnit;
  /** The unit shown on the pill face (a carousel page's own account). */
  shownUnit: ActiveUnit;
  shownOption: UnitOption;
  /** Offered unit options, in menu order. */
  availableOptions: UnitOption[];
  /** False when no other available unit can replace the displayed account. */
  canSwitch: boolean;
  handleSelectUnit: (unit: ActiveUnit) => void;
  textSize: number;
}

export function useUnitSwitcherPill({
  textSize = 12,
  displayUnit,
  onSelectUnit,
  presentation = false,
}: UnitSwitcherPillProps): UnitSwitcherPillShared {
  const { unit, availableUnits, selectUnit } = useWalletPresentationUnit(presentation);
  const shownUnit = displayUnit ?? unit;
  const availableOptions = UNIT_OPTIONS.filter((option) => availableUnits.includes(option.unit));
  const canSwitch = availableOptions.some((option) => option.unit !== shownUnit);

  const handleSelectUnit = useCallback(
    (next: ActiveUnit) => {
      walletLog.info('wallet.unit.menu_selected', { from: unit, to: next });
      if (onSelectUnit) onSelectUnit(next);
      else selectUnit(next);
    },
    [unit, selectUnit, onSelectUnit]
  );

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
