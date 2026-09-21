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

/**
 * The rows a currency tab lists. A unit tab lists the mints that can issue that
 * account unit. `ALL` spans the active ACCOUNT's units only: a mint across the
 * testnut split already has its own tabs (TSAT, TUSD, …), so listing it under
 * `ALL` as well would sit test mints among real ones. Rows with unknown
 * `supportedUnits` (fallback rows, before enrichment) always pass — never hide
 * a mint on missing data.
 */
export function filterMintsForCurrencyTab<T extends { supportedUnits?: string[] }>(
  items: readonly T[],
  selectedCurrency: string,
  testnutAccount: boolean
): T[] {
  return items.filter((item) => {
    if (!item.supportedUnits) return true;
    return selectedCurrency === 'ALL'
      ? item.supportedUnits.length === 0 ||
          item.supportedUnits.some((unit) => isTestnutUnit(unit) === testnutAccount)
      : item.supportedUnits.some((unit) => unit.toUpperCase() === selectedCurrency);
  });
}
