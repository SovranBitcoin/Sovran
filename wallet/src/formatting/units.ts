// ---------------------------------------------------------------------------
// Unit denomination helpers
//
// Cashu fiat units are minor-denominated (usd = cents). These helpers are the
// single colada-side source for how a unit's minor amounts map to the
// major-denomination strings users type and read. 'sat' (and unknown units)
// have no minor scaling and no symbol.
// ---------------------------------------------------------------------------

const FIAT_UNIT_SYMBOLS: Record<string, string> = {
  usd: '$',
  eur: '€',
  gbp: '£',
};

/** Currency symbol for a fiat unit; '' for sat and unknown units. */
export function unitSymbol(unit: string): string {
  return FIAT_UNIT_SYMBOLS[unit.toLowerCase()] ?? '';
}

/** Decimal places between a unit's minor amounts and its major display. */
export function unitMinorDecimals(unit: string): number {
  return unit.toLowerCase() in FIAT_UNIT_SYMBOLS ? 2 : 0;
}

/** True for units entered as major-denomination decimals (usd/eur/gbp). */
export function isFiatUnit(unit: string): boolean {
  return unit.toLowerCase() in FIAT_UNIT_SYMBOLS;
}

/**
 * Convert a typed major-denomination value to integer minor units.
 * Math.round kills parseFloat dust ("1.005" * 100 === 100.49999…).
 */
export function majorToMinor(value: number, unit: string): number {
  return Math.round(value * 10 ** unitMinorDecimals(unit));
}

/**
 * Render integer minor units as the most natural raw-input string:
 * 200 usd-cents → "2", 210 → "2.1", 2 → "0.02"; sat passes through.
 */
export function minorToRawInput(minor: number, unit: string): string {
  if (minor <= 0) return '';
  const decimals = unitMinorDecimals(unit);
  if (decimals === 0) return String(minor);
  const major = (minor / 10 ** decimals).toFixed(decimals);
  return major.replace(/0+$/, '').replace(/\.$/, '');
}
