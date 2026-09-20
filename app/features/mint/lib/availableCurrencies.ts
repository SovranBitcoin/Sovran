import { isTestnutUnit } from 'wallet';

/**
 * Unique uppercase units: real units first (SAT leading, the rest
 * alphabetical), then the testnut account units (TSAT, TUSD, …) in the same
 * order, so test mints sit in their own tabs after the real ones.
 */
export function extractAvailableCurrencies(unitLists: string[][]): string[] {
  const units = new Set(unitLists.flat().map((unit) => unit.toUpperCase()));
  const rank = (unit: string) => (unit === 'SAT' || unit === 'TSAT' ? 0 : 1);
  return [...units].sort(
    (a, b) =>
      Number(isTestnutUnit(a)) - Number(isTestnutUnit(b)) || rank(a) - rank(b) || a.localeCompare(b)
  );
}
