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
  // Normalize input unit (handle 'sat' -> 'sats' conversion)
  const inputUnit = input.unit.toLowerCase() === 'sat' ? 'sats' : input.unit.toLowerCase();
  const outputUnit = options.displayAs?.toLowerCase() || inputUnit;

  // Handle user preference for sats display (BTC vs sats)
  if (options.useUserPreference && inputUnit === 'sats') {
    const displayBtc = useSettingsStore.getState().getDisplayBtc();
    const precision = displayBtc === 0 ? 8 : 0;
    const value = displayBtc === 0 ? input.amount / 100_000_000 : input.amount;
    const formatted = value.toLocaleString('en-US', {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
    return displayBtc === 2 ? `${formatted} sats` : formatted;
  }

  // Convert value through BTC as base currency
  const adjustedInput = FIAT_UNITS.includes(inputUnit) ? input.amount / 100 : input.amount;
  const inBtc = adjustedInput / getRate(inputUnit);
  const outputValue = inBtc * getRate(outputUnit);

  // Determine precision based on output unit
  const precision = outputUnit === 'btc' ? 8 : outputUnit === 'sats' ? 0 : 2;

  // Format number with appropriate precision
  const formatted = outputValue.toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });

  // Apply currency display formatting
  const display = options.currencyDisplay ?? (FIAT_UNITS.includes(outputUnit) ? 'symbol' : 'none');

  if (display === 'symbol' && SYMBOLS[outputUnit]) {
    return `${SYMBOLS[outputUnit]}${formatted}`;
  }
  if (display === 'name') {
    return `${formatted} ${outputUnit}`;
  }

  return formatted;
}
