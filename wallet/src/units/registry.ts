// ---------------------------------------------------------------------------
// The unit registry — the ONE declaration of which mint units the wallet
// offers and what each of them is.
//
// Every unit list, union type, symbol map and label elsewhere derives from
// `UNITS`. Adding a unit is one entry here; a second hand-written
// `'sat' | 'usd' | …` union or `{ usd: '$', … }` map is a bug waiting for the
// day the two drift apart. Presentation that belongs to the app (icons) keys a
// `Record<SwitchableUnit, …>` so the compiler demands the new entry too.
// ---------------------------------------------------------------------------

interface UnitDefinition {
  /** Short code shown on tabs and badges. `sat` reads BTC: it is the Bitcoin account. */
  label: string;
  /** Spelled-out name for menus and accessibility. */
  name: string;
  /** Currency symbol; '' when amounts carry no symbol. */
  symbol: string;
  /** Decimal places between the unit's minor amounts and its major display. */
  minorDecimals: number;
}

const UNITS = {
  sat: { label: "BTC", name: "Bitcoin", symbol: "", minorDecimals: 0 },
  usd: { label: "USD", name: "US Dollar", symbol: "$", minorDecimals: 2 },
  eur: { label: "EUR", name: "Euro", symbol: "€", minorDecimals: 2 },
  gbp: { label: "GBP", name: "British Pound", symbol: "£", minorDecimals: 2 },
} as const satisfies Record<string, UnitDefinition>;

/** A mint unit the wallet's unit switcher may offer. */
export type SwitchableUnit = keyof typeof UNITS;
/** A switchable unit entered as major-denomination decimals (usd / eur / gbp). */
export type FiatUnit = {
  [U in SwitchableUnit]: (typeof UNITS)[U]["minorDecimals"] extends 0 ? never : U;
}[SwitchableUnit];

/** Units the wallet's unit switcher may offer, in display order. */
export const SWITCHABLE_UNITS = Object.keys(UNITS) as SwitchableUnit[];
/** The switchable fiat units, in display order. */
export const FIAT_UNITS = SWITCHABLE_UNITS.filter(
  (unit): unit is FiatUnit => UNITS[unit].minorDecimals > 0,
);

export function isSwitchableUnit(unit: string): unit is SwitchableUnit {
  return Object.hasOwn(UNITS, unit);
}

/** The registry entry for a unit, or undefined for one the wallet doesn't offer. */
export function unitDefinition(unit: string): UnitDefinition | undefined {
  const normalized = unit.toLowerCase();
  return isSwitchableUnit(normalized) ? UNITS[normalized] : undefined;
}
