/**
 * Currency formatting and conversion utilities.
 *
 * All rates are fetched from pricelistStore (Zustand) at call time.
 * Fiat amounts are stored as cents (÷100 before conversion).
 * Conversions route through BTC as the base unit.
 */

import { usePricelistStore } from 'stores/pricelistStore';
import { useSettingsStore } from 'stores/settingsStore';

interface AmountWithUnit {
  amount: number;
  unit: string;
}

interface FormatAmountOptions {
  displayAs?: string;
  currencyDisplay?: 'symbol' | 'name' | 'none';
  /** When true and unit is sats, respects user's BTC/sats display preference. */
  useUserPreference?: boolean;
}

const SYMBOLS: Record<string, string> = {
  usd: '$',
  eur: '€',
  gbp: '£',
  btc: '₿',
  sats: 'ṩ',
};

const FIAT_UNITS = ['usd', 'eur', 'gbp'];

const satsFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const fiatFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const btcFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 8,
  maximumFractionDigits: 8,
});

function getFormatter(unit: string): Intl.NumberFormat {
  if (unit === 'btc') return btcFormatter;
  if (unit === 'sats') return satsFormatter;
  return fiatFormatter;
}

/** Exchange rate relative to BTC. Falls back to hardcoded estimates if pricelist is empty. */
function getRate(unit: string): number {
  const pricelist = usePricelistStore.getState().pricelist;
  const rates: Record<string, number> = {
    btc: 1,
    sats: 100_000_000,
    usd: pricelist?.usd?.btc ?? 63_900,
    eur: pricelist?.eur?.btc ?? 53_500,
    gbp: pricelist?.gbp?.btc ?? 47_800,
  };
  return rates[unit] ?? 1;
}

export function formatAmount(input: AmountWithUnit, options: FormatAmountOptions = {}): string {
  const inputUnit = input.unit.toLowerCase() === 'sat' ? 'sats' : input.unit.toLowerCase();
  const outputUnit = options.displayAs?.toLowerCase() || inputUnit;

  if (options.useUserPreference && inputUnit === 'sats') {
    const displayBtc = useSettingsStore.getState().getDisplayBtc();
    const asBtc = displayBtc === 0;
    const value = asBtc ? input.amount / 100_000_000 : input.amount;
    const formatted = (asBtc ? btcFormatter : satsFormatter).format(value);
    return displayBtc === 2 ? `${formatted} sats` : formatted;
  }

  const adjustedInput = FIAT_UNITS.includes(inputUnit) ? input.amount / 100 : input.amount;
  const inBtc = adjustedInput / getRate(inputUnit);
  const outputValue = inBtc * getRate(outputUnit);

  const formatted = getFormatter(outputUnit).format(outputValue);

  const display = options.currencyDisplay ?? (FIAT_UNITS.includes(outputUnit) ? 'symbol' : 'none');

  if (display === 'symbol' && SYMBOLS[outputUnit]) {
    return `${SYMBOLS[outputUnit]}${formatted}`;
  }
  if (display === 'name') {
    return `${formatted} ${outputUnit}`;
  }

  return formatted;
}
