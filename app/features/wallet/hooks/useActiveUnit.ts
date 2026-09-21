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

/** What `useActiveUnit` knows about the units some mint can issue. */
interface UnitAvailability {
  units: ActiveUnit[];
  /**
   * Whether any mint has actually reported yet. `sat` is seeded
   * unconditionally, so a list of just `sat` is equally "nothing has loaded"
   * and "no mint offers anything else".
   */
  resolved: boolean;
}

/**
 * The account unit the wallet is denominated in: the persisted choice, retired
 * to `sat` only once something has ANSWERED that no mint supports it.
 *
 * Mint info and keysets load asynchronously. Retiring the choice before then
 * flips the whole wallet to `sat` and back the moment they arrive, and every
 * per-unit derivation in between — the capability map, the rails a mint can
 * serve, the bounds a rail is gated on — is computed for the wrong unit. A
 * captured session showed the derived unit alternating usd/sat a dozen times.
 */
export function resolveActiveUnit(
  persisted: ActiveUnit,
  availability: UnitAvailability
): ActiveUnit {
  if (availability.units.includes(persisted)) return persisted;
  if (!availability.resolved) return persisted;
  walletLog.info('wallet.unit.fallback', { persisted, fallback: 'sat' });
  return 'sat';
}

/**
 * The wallet's active mint unit (coco v2 multi-unit) — the unit ecash is
 * denominated in, scoping balance, amount entry, receive/send defaults, and
 * the transaction list. NOT the fiat display currency.
 *
 * A testnut mint's units are separate accounts (`tsat`, `tusd`, … — wallet
 * `units/accounts`), classified from the locally cached nagg verdicts in
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

  const availability = useMemo(() => {
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
    // Whether anything has actually REPORTED yet. `sat` is seeded
    // unconditionally, so a list of just `sat` is equally "no mint has loaded"
    // and "no mint offers anything else" — and those must not be treated alike.
    const resolved =
      trustedMints.some((mint) => !!mint.mintInfo) ||
      Object.keys(balances.byMintAndUnit ?? {}).length > 0;
    walletLog.debug('wallet.unit.available', {
      units: units.join(','),
      source: 'nut04+keysets+balances',
      mintCount: trustedMints.length,
      resolved,
    });
    return { units, resolved };
  }, [trustedMints, balances, keysetUnitsByMint, isTestnutMint]);

  const availableUnits = availability.units;

  const unit = useMemo<ActiveUnit>(
    () => resolveActiveUnit(persisted, availability),
    [persisted, availability]
  );

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
