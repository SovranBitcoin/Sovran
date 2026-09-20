/**
 * App-side presentation of the wallet's units — the icons the unit registry
 * (wallet `units.ts`) deliberately doesn't know about. Which units exist, their
 * labels, names, symbols and decimals all come from that registry; this file
 * adds only what is specific to this app's icon sets, keyed so the compiler
 * demands an entry for every unit the registry gains.
 *
 * Any of these accept an ACCOUNT unit (`tusd`): a testnut account looks like
 * the unit behind it.
 */
import { toRealUnit, unitDefinition, type FiatUnit, type SwitchableUnit } from 'wallet/units';

/** Iconify circle-flag per fiat unit; `sat` renders the branded `CurrencyIcon`. */
const FLAG_ICONS: Record<FiatUnit, string> = {
  usd: 'circle-flags:us',
  eur: 'circle-flags:eu',
  gbp: 'circle-flags:gb',
};

/** SF Symbol per unit, for native menu rows. */
const SF_SYMBOLS: Record<SwitchableUnit, string> = {
  sat: 'bitcoinsign',
  usd: 'dollarsign',
  eur: 'eurosign',
  gbp: 'sterlingsign',
};

/** The unit's flag icon, or undefined for Bitcoin and units the wallet doesn't offer. */
export function unitFlagIcon(unit: string): string | undefined {
  return (FLAG_ICONS as Record<string, string | undefined>)[toRealUnit(unit)];
}

/** The unit's SF Symbol, or undefined for a unit the wallet doesn't offer. */
export function unitSfSymbol(unit: string): string | undefined {
  return (SF_SYMBOLS as Record<string, string | undefined>)[toRealUnit(unit)];
}

/** The unit's spelled-out name ("US Dollar"), falling back to its code. */
export function unitName(unit: string): string {
  const real = toRealUnit(unit);
  return unitDefinition(real)?.name ?? real.toUpperCase();
}
