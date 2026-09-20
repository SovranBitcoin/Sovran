// ---------------------------------------------------------------------------
// Account units
//
// A testnut is a mint with a fake payment backend: it marks mint quotes paid
// without being paid, so its ecash is worthless. Its keysets still say `sat` /
// `usd`, which would let test funds share a balance, a mint picker tab, or a
// Balance split with real ones. An ACCOUNT unit keeps them apart: a testnut
// mint's `usd` is the `tusd` account, a real mint's `usd` stays `usd`.
//
// Account units are a wallet-view concept only. Coco, the payment machine,
// tokens, quotes and payment requests all speak the mint's REAL unit — convert
// with `toRealUnit` before any of them sees a unit.
//
// Derived from the unit registry (`registry.ts`): every switchable unit has
// exactly one testnut counterpart, `t` + the unit.
// ---------------------------------------------------------------------------

import {
  isSwitchableUnit,
  SWITCHABLE_UNITS,
  unitDefinition,
  type SwitchableUnit,
} from "./registry";

export type TestnutUnit = `t${SwitchableUnit}`;
export type AccountUnit = SwitchableUnit | TestnutUnit;

const testnutUnitOf = (unit: SwitchableUnit): TestnutUnit => `t${unit}`;

const REAL_UNIT_BY_TESTNUT = new Map<string, SwitchableUnit>(
  SWITCHABLE_UNITS.map((unit) => [testnutUnitOf(unit), unit]),
);

/** Every account the unit switcher may offer, in display order: real, then testnut. */
export const ACCOUNT_UNITS: readonly AccountUnit[] = [
  ...SWITCHABLE_UNITS,
  ...SWITCHABLE_UNITS.map(testnutUnitOf),
];

export function isAccountUnit(unit: string): unit is AccountUnit {
  return isSwitchableUnit(unit) || REAL_UNIT_BY_TESTNUT.has(unit);
}

/** True for a testnut account unit (`tsat`, `tusd`, …). */
export function isTestnutUnit(unit: string): boolean {
  return REAL_UNIT_BY_TESTNUT.has(unit.toLowerCase());
}

/** The mint unit behind an account unit: `tusd` → `usd`; real units pass through. */
export function toRealUnit(unit: string): string {
  const normalized = unit.toLowerCase();
  return REAL_UNIT_BY_TESTNUT.get(normalized) ?? normalized;
}

/**
 * The account a mint's unit belongs to. A unit with no testnut counterpart
 * passes through: it is not switchable, so it never reaches a picker.
 */
export function toAccountUnit(unit: string, testnut: boolean): string {
  const normalized = unit.toLowerCase();
  return testnut && isSwitchableUnit(normalized)
    ? testnutUnitOf(normalized)
    : normalized;
}

/** Short tab / badge label: `sat` → BTC, `tsat` → tBTC, `tusd` → tUSD. */
export function accountUnitLabel(unit: string): string {
  const real = toRealUnit(unit);
  const label = unitDefinition(real)?.label ?? real.toUpperCase();
  return isTestnutUnit(unit) ? `t${label}` : label;
}

/** Menu / accessibility name: `usd` → "USD account", `tsat` → "Test Bitcoin account". */
export function accountUnitName(unit: string): string {
  const real = toRealUnit(unit);
  // Bitcoin reads by name; fiat accounts by their code, as the app always has.
  const base =
    real === "sat"
      ? (unitDefinition(real)?.name ?? "Bitcoin")
      : (unitDefinition(real)?.label ?? real.toUpperCase());
  return `${isTestnutUnit(unit) ? "Test " : ""}${base} account`;
}
