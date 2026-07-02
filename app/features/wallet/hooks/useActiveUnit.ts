import { useMemo } from 'react';
import { useBalanceContext, useMints } from '@cashu/coco-react';
import { deriveSupportedUnitsFromInfo, SWITCHABLE_UNITS } from 'wallet';

import { useMintStore, type ActiveUnit } from '@/shared/stores/profile/mintStore';
import { walletLog } from '@/shared/lib/logger';
import { amountToNumber } from '@/shared/lib/cashu/amount';

export interface ActiveUnitState {
  /** The unit the wallet view is denominated in right now. */
  unit: ActiveUnit;
  /** Switchable units at least one trusted mint advertises (sat always). */
  availableUnits: ActiveUnit[];
  setUnit: (unit: ActiveUnit) => void;
}

/**
 * The wallet's active mint unit (coco v2 multi-unit) — the unit ecash is
 * denominated in, scoping balance, amount entry, receive/send defaults, and
 * the transaction list. NOT the fiat display currency.
 *
 * Availability derives synchronously from trusted mints' cached NUT-04
 * method-unit metadata (coco validates again at quote creation); a persisted
 * selection that no trusted mint supports anymore falls back to sat without
 * overwriting the persisted choice.
 */
export function useActiveUnit(): ActiveUnitState {
  const persisted = useMintStore((state) => state.activeUnit);
  const setUnit = useMintStore((state) => state.setActiveUnit);
  const { trustedMints } = useMints();
  const { balances } = useBalanceContext();

  const availableUnits = useMemo(() => {
    const advertised = new Set<string>(['sat']);
    for (const mint of trustedMints) {
      for (const unit of deriveSupportedUnitsFromInfo(mint.mintInfo)) {
        advertised.add(unit);
      }
    }
    // Funds the wallet already HOLDS stay reachable even if no trusted mint
    // advertises the unit anymore (e.g. the usd mint was untrusted) — hiding
    // the unit would make that balance invisible with no way back.
    for (const [unit, snapshot] of Object.entries(balances.byUnit ?? {})) {
      if (snapshot && amountToNumber(snapshot.total) > 0) advertised.add(unit);
    }
    const units = SWITCHABLE_UNITS.filter((unit) => advertised.has(unit)) as ActiveUnit[];
    walletLog.debug('wallet.unit.available', {
      units: units.join(','),
      source: 'nut04+balances',
      mintCount: trustedMints.length,
    });
    return units;
  }, [trustedMints, balances]);

  const unit = useMemo<ActiveUnit>(() => {
    if (availableUnits.includes(persisted)) return persisted;
    walletLog.info('wallet.unit.fallback', { persisted, fallback: 'sat' });
    return 'sat';
  }, [persisted, availableUnits]);

  return useMemo(() => ({ unit, availableUnits, setUnit }), [unit, availableUnits, setUnit]);
}
