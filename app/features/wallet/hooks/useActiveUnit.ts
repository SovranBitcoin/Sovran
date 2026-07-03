import { useCallback, useMemo } from 'react';
import { useBalanceContext, useMints } from '@cashu/coco-react';
import { deriveSupportedUnitsFromInfo, pickMintForUnit, SWITCHABLE_UNITS } from 'wallet';

import { useMintStore, type ActiveUnit } from '@/shared/stores/profile/mintStore';
import { walletLog } from '@/shared/lib/logger';
import { amountToNumber } from '@/shared/lib/cashu/amount';

import { useMintKeysetUnits } from './useMintKeysetUnits';

export interface ActiveUnitState {
  /** The unit the wallet view is denominated in right now. */
  unit: ActiveUnit;
  /** Switchable units at least one trusted mint advertises (sat always). */
  availableUnits: ActiveUnit[];
  /** Raw unit write — no mint coordination. For sync effects, not user picks. */
  setUnit: (unit: ActiveUnit) => void;
  /**
   * User-initiated unit pick: sets the unit AND, when the preferred mint
   * doesn't support it, follows with the highest-balance (in that unit)
   * trusted mint that does — so the wallet never assumes the current mint
   * can serve the chosen unit.
   */
  selectUnit: (unit: ActiveUnit) => void;
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
  // Units each mint actually has keysets for — an advertised unit without a
  // backing keyset is not offerable (coco throws "No valid keysets found").
  const keysetUnitsByMint = useMintKeysetUnits();

  const availableUnits = useMemo(() => {
    const advertised = new Set<string>(['sat']);
    for (const mint of trustedMints) {
      const units = deriveSupportedUnitsFromInfo(mint.mintInfo, keysetUnitsByMint[mint.mintUrl]);
      for (const unit of units) {
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
      source: 'nut04+keysets+balances',
      mintCount: trustedMints.length,
    });
    return units;
  }, [trustedMints, balances, keysetUnitsByMint]);

  const unit = useMemo<ActiveUnit>(() => {
    if (availableUnits.includes(persisted)) return persisted;
    walletLog.info('wallet.unit.fallback', { persisted, fallback: 'sat' });
    return 'sat';
  }, [persisted, availableUnits]);

  const selectUnit = useCallback(
    (next: ActiveUnit) => {
      setUnit(next);
      const preferredUrl = useMintStore.getState().selectedMint;
      const preferred = trustedMints.find((m) => m.mintUrl === preferredUrl);
      if (
        preferred &&
        deriveSupportedUnitsFromInfo(
          preferred.mintInfo,
          keysetUnitsByMint[preferred.mintUrl]
        ).includes(next)
      ) {
        return;
      }
      // Balance IN THE CHOSEN UNIT per mint — colada picks the best target.
      const balanceByMint = Object.fromEntries(
        Object.entries(balances.byMintAndUnit ?? {}).map(([url, byUnit]) => [
          url,
          byUnit[next] ? amountToNumber(byUnit[next].total) : 0,
        ])
      );
      const target = pickMintForUnit(
        trustedMints.map((mint) => ({
          mintUrl: mint.mintUrl,
          mintInfo: mint.mintInfo,
          keysetUnits: keysetUnitsByMint[mint.mintUrl],
        })),
        next,
        balanceByMint
      );
      if (!target || target === preferredUrl) return;
      walletLog.info('wallet.unit.mint_followed_unit', {
        unit: next,
        hadPreferredMint: !!preferred,
        targetMintUrlLength: target.length,
      });
      useMintStore.getState().setSelectedMint(target);
    },
    [trustedMints, balances, setUnit, keysetUnitsByMint]
  );

  return useMemo(
    () => ({ unit, availableUnits, setUnit, selectUnit }),
    [unit, availableUnits, setUnit, selectUnit]
  );
}
