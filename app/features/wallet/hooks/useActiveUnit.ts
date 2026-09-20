import { useCallback, useMemo } from 'react';
import { useBalanceContext, useMints } from '@cashu/coco-react';
import {
  ACCOUNT_UNITS,
  deriveSupportedUnitsFromInfo,
  isTestnutUnit,
  pickMintForUnit,
  toAccountUnit,
  toRealUnit,
} from 'wallet';

import { useMintStore, type ActiveUnit } from '@/shared/stores/profile/mintStore';
import { walletLog } from '@/shared/lib/logger';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { useIsTestnutMint } from '@/shared/stores/global/mintTestnutStore';

import { useMintKeysetUnits } from './useMintKeysetUnits';

interface ActiveUnitState {
  /** The ACCOUNT unit the wallet view is denominated in right now. */
  unit: ActiveUnit;
  /** The mint unit behind `unit` — what coco, quotes and tokens speak. */
  realUnit: string;
  /** True while a testnut account (`tsat`, `tusd`, …) is active. */
  testnut: boolean;
  /** Account units at least one trusted mint advertises (sat always). */
  availableUnits: ActiveUnit[];
  /** Raw unit write — no mint coordination. For sync effects, not user picks. */
  setUnit: (unit: ActiveUnit) => void;
  /**
   * User-initiated unit pick: sets the unit AND, when the preferred mint
   * doesn't support it, follows with the highest-balance (in that unit)
   * trusted mint that does — so the wallet never assumes the current mint
   * can serve the chosen unit. Only mints on the unit's side of the testnut
   * split are candidates: picking `usd` never lands on a testnut mint.
   */
  selectUnit: (unit: ActiveUnit) => void;
}

/**
 * The wallet's active mint unit (coco v2 multi-unit) — the unit ecash is
 * denominated in, scoping balance, amount entry, receive/send defaults, and
 * the transaction list. NOT the fiat display currency.
 *
 * A testnut mint's units are separate accounts (`tsat`, `tusd`, … — wallet
 * `account-units`), classified from the locally cached nagg verdicts in
 * `mintTestnutStore`, never a network call.
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
  const isTestnutMint = useIsTestnutMint();

  const availableUnits = useMemo(() => {
    const advertised = new Set<string>(['sat']);
    for (const mint of trustedMints) {
      const units = deriveSupportedUnitsFromInfo(mint.mintInfo, keysetUnitsByMint[mint.mintUrl]);
      for (const unit of units) {
        advertised.add(toAccountUnit(unit, isTestnutMint(mint.mintUrl)));
      }
    }
    // Funds the wallet already HOLDS stay reachable even if no trusted mint
    // advertises the unit anymore (e.g. the usd mint was untrusted) — hiding
    // the unit would make that balance invisible with no way back.
    for (const [mintUrl, byUnit] of Object.entries(balances.byMintAndUnit ?? {})) {
      for (const [unit, snapshot] of Object.entries(byUnit)) {
        if (snapshot && amountToNumber(snapshot.total) > 0)
          advertised.add(toAccountUnit(unit, isTestnutMint(mintUrl)));
      }
    }
    const units = ACCOUNT_UNITS.filter((unit) => advertised.has(unit));
    walletLog.debug('wallet.unit.available', {
      units: units.join(','),
      source: 'nut04+keysets+balances',
      mintCount: trustedMints.length,
    });
    return units;
  }, [trustedMints, balances, keysetUnitsByMint, isTestnutMint]);

  const unit = useMemo<ActiveUnit>(() => {
    if (availableUnits.includes(persisted)) return persisted;
    walletLog.info('wallet.unit.fallback', { persisted, fallback: 'sat' });
    return 'sat';
  }, [persisted, availableUnits]);

  const selectUnit = useCallback(
    (next: ActiveUnit) => {
      setUnit(next);
      const nextReal = toRealUnit(next);
      // Only mints on the chosen account's side of the testnut split.
      const accountMints = trustedMints.filter(
        (mint) => isTestnutMint(mint.mintUrl) === isTestnutUnit(next)
      );
      const preferredUrl = useMintStore.getState().selectedMint;
      const preferred = accountMints.find((m) => m.mintUrl === preferredUrl);
      if (
        preferred &&
        deriveSupportedUnitsFromInfo(
          preferred.mintInfo,
          keysetUnitsByMint[preferred.mintUrl]
        ).includes(nextReal)
      ) {
        return;
      }
      // Balance IN THE CHOSEN UNIT per mint — colada picks the best target.
      const balanceByMint = Object.fromEntries(
        Object.entries(balances.byMintAndUnit ?? {}).map(([url, byUnit]) => [
          url,
          byUnit[nextReal] ? amountToNumber(byUnit[nextReal].total) : 0,
        ])
      );
      const target = pickMintForUnit(
        accountMints.map((mint) => ({
          mintUrl: mint.mintUrl,
          mintInfo: mint.mintInfo,
          keysetUnits: keysetUnitsByMint[mint.mintUrl],
        })),
        nextReal,
        balanceByMint
      );
      if (!target || target === preferredUrl) return;
      walletLog.info('wallet.unit.mint_followed_unit', {
        unit: next,
        hadPreferredMint: !!preferredUrl,
        targetMintUrlLength: target.length,
      });
      useMintStore.getState().setSelectedMint(target);
    },
    [trustedMints, balances, setUnit, keysetUnitsByMint, isTestnutMint]
  );

  return useMemo(
    () => ({
      unit,
      realUnit: toRealUnit(unit),
      testnut: isTestnutUnit(unit),
      availableUnits,
      setUnit,
      selectUnit,
    }),
    [unit, availableUnits, setUnit, selectUnit]
  );
}
