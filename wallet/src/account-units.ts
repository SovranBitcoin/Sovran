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
// ---------------------------------------------------------------------------

const TESTNUT_UNIT_BY_REAL = {
  sat: "tsat",
  usd: "tusd",
  eur: "teur",
  gbp: "tgbp",
} as const;

type RealAccountUnit = keyof typeof TESTNUT_UNIT_BY_REAL;
export type TestnutUnit = (typeof TESTNUT_UNIT_BY_REAL)[RealAccountUnit];
export type AccountUnit = RealAccountUnit | TestnutUnit;

const REAL_UNIT_BY_TESTNUT: Record<string, RealAccountUnit> = Object.fromEntries(
  Object.entries(TESTNUT_UNIT_BY_REAL).map(([real, testnut]) => [testnut, real]),
) as Record<string, RealAccountUnit>;

/** Every account the unit switcher may offer, in display order: real, then testnut. */
export const ACCOUNT_UNITS: readonly AccountUnit[] = [
  ...(Object.keys(TESTNUT_UNIT_BY_REAL) as RealAccountUnit[]),
  ...Object.values(TESTNUT_UNIT_BY_REAL),
];

/** True for a testnut account unit (`tsat`, `tusd`, …). */
export function isTestnutUnit(unit: string): boolean {
  return unit.toLowerCase() in REAL_UNIT_BY_TESTNUT;
}

/** The mint unit behind an account unit: `tusd` → `usd`; real units pass through. */
export function toRealUnit(unit: string): string {
  const normalized = unit.toLowerCase();
  return REAL_UNIT_BY_TESTNUT[normalized] ?? normalized;
}

/**
 * The account a mint's unit belongs to. A unit with no testnut counterpart
 * passes through: it is not switchable, so it never reaches a picker.
 */
export function toAccountUnit(unit: string, testnut: boolean): string {
  const normalized = unit.toLowerCase();
  if (!testnut) return normalized;
  return (
    (TESTNUT_UNIT_BY_REAL as Record<string, string>)[normalized] ?? normalized
  );
}

/** Short tab / badge label: `sat` → BTC, `tsat` → tBTC, `tusd` → tUSD. */
export function accountUnitLabel(unit: string): string {
  const real = toRealUnit(unit);
  const label = real === "sat" ? "BTC" : real.toUpperCase();
  return isTestnutUnit(unit) ? `t${label}` : label;
}
