import { store } from 'helper/redux/store';
import { memoizedPricelist } from 'helper/redux/pricelist';

/**
 * Type representing an amount with its unit (aligns with Coco's HistoryEntry)
 */
export interface AmountWithUnit {
  amount: number;
  unit: string;
}

/**
 * Display options for formatting
 */
export interface FormatAmountOptions {
  displayAs?: string; // target unit to convert to
  precision?: number;
  currencyDisplay?: 'symbol' | 'name' | 'none';
  useUserPreference?: boolean; // only applies to sats
}

const SYMBOLS: Record<string, string> = {
  usd: '$',
  eur: '€',
  gbp: '£',
  btc: '₿',
  aud: 'A$',
  cad: 'C$',
  nzd: 'NZ$',
  krw: '₩',
  sats: 'ṩ',
};

const FIAT_UNITS = ['usd', 'eur', 'gbp', 'aud', 'cad', 'nzd', 'krw'];

function getRate(unit: string): number {
  const pricelist = memoizedPricelist(store.getState());
  const rates: Record<string, number> = {
    btc: 1,
    sats: 100_000_000,
    usd: pricelist?.usd?.btc ?? 63_900,
    eur: 53_500,
    gbp: 47_800,
    aud: 45_000,
    cad: 50_000,
    nzd: 43_000,
    krw: 75_000_000,
  };
  return rates[unit] ?? 1;
}

/**
 * Format an amount with its unit
 */
export function formatAmount(input: AmountWithUnit, options: FormatAmountOptions = {}): string {
  const inputUnit = input.unit.toLowerCase() === 'sat' ? 'sats' : input.unit.toLowerCase();
  const outputUnit = options.displayAs?.toLowerCase() || inputUnit;

  // Handle user preference for sats
  if (options.useUserPreference && inputUnit === 'sats') {
    const displayBtc = store.getState().settings.settings.display_btc ?? 1;
    const precision = displayBtc === 0 ? 8 : 0;
    const value = displayBtc === 0 ? input.amount / 100_000_000 : input.amount;
    const formatted = value.toLocaleString('en-US', {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
    return displayBtc === 2 ? `${formatted} sats` : formatted;
  }

  // Convert value
  const adjustedInput = FIAT_UNITS.includes(inputUnit) ? input.amount / 100 : input.amount;
  const inBtc = adjustedInput / getRate(inputUnit);
  const outputValue = inBtc * getRate(outputUnit);

  // Determine precision
  const precision =
    options.precision ??
    (outputUnit === 'btc' ? 8 : outputUnit === 'sats' || outputUnit === 'krw' ? 0 : 2);

  // Format number
  const formatted = outputValue.toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });

  // Add symbol/name
  const display = options.currencyDisplay ?? (FIAT_UNITS.includes(outputUnit) ? 'symbol' : 'none');

  if (display === 'symbol' && SYMBOLS[outputUnit]) {
    return `${SYMBOLS[outputUnit]}${formatted}`;
  }
  if (display === 'name') {
    return `${formatted} ${outputUnit}`;
  }

  return formatted;
}
