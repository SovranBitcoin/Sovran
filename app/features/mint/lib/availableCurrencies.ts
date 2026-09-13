/** Unique uppercase units, with SAT first and the rest in stable alphabetical order. */
export function extractAvailableCurrencies(unitLists: string[][]): string[] {
  const units = new Set(unitLists.flat().map((unit) => unit.toUpperCase()));
  return [...units].sort((a, b) => (a === 'SAT' ? -1 : b === 'SAT' ? 1 : a.localeCompare(b)));
}
