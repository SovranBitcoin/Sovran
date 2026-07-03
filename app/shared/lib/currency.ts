/**
 * Currency formatting and conversion utilities.
 *
 * All rates are fetched from pricelistStore (Zustand) at call time.
 * Fiat amounts are stored as cents (÷100 before conversion).
 * Conversions route through BTC as the base unit.
 */

import { usePricelistStore } from '@/shared/stores/global/pricelistStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { amountToNumber, type AmountValue } from '@/shared/lib/cashu/amount';
import { cashuLog } from '@/shared/lib/logger';

interface AmountWithUnit {
  amount: AmountValue;
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
  // Render-hot path (every displayed amount) — log only the anomalous case.
  if (rates[unit] == null) {
    cashuLog.warn('currency.rate.unknown_unit', { unit, hasPricelist: !!pricelist });
    return 1;
  }
  return rates[unit];
}

export function formatAmount(input: AmountWithUnit, options: FormatAmountOptions = {}): string {
  const inputUnit = input.unit.toLowerCase() === 'sat' ? 'sats' : input.unit.toLowerCase();
  const outputUnit = options.displayAs?.toLowerCase() || inputUnit;
  const amount = amountToNumber(input.amount);

  if (options.useUserPreference && inputUnit === 'sats') {
    const displayBtc = useSettingsStore.getState().getDisplayBtc();
    const asBtc = displayBtc === 0;
    const value = asBtc ? amount / 100_000_000 : amount;
    const formatted = (asBtc ? btcFormatter : satsFormatter).format(value);
    return displayBtc === 2 ? `${formatted} sats` : formatted;
  }

  const adjustedInput = FIAT_UNITS.includes(inputUnit) ? amount / 100 : amount;
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
