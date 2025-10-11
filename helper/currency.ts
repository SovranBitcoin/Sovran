/**
 * @fileoverview Currency formatting utilities for the Sovran application
 *
 * This module provides comprehensive currency formatting functionality including
 * unit conversion, precision handling, and display formatting for various
 * cryptocurrency and fiat currencies. It integrates with the Redux store for
 * real-time price data and user preferences.
 */

import { store } from 'redux/store';
import { memoizedPricelist } from 'redux/pricelist';

/**
 * Represents an amount with its associated currency unit
 *
 * This interface aligns with Coco's HistoryEntry structure and is used
 * throughout the application for consistent amount handling.
 *
 * @interface AmountWithUnit
 * @property {number} amount - The numeric amount value
 * @property {string} unit - The currency unit (e.g., 'sats', 'usd', 'btc')
 *
 * @example
 * const amount: AmountWithUnit = { amount: 1000, unit: 'sats' };
 * const usdAmount: AmountWithUnit = { amount: 25.50, unit: 'usd' };
 */
export interface AmountWithUnit {
  amount: number;
  unit: string;
}

/**
 * Configuration options for currency amount formatting
 *
 * @interface FormatAmountOptions
 * @property {string} [displayAs] - Target unit to convert to (e.g., 'usd', 'sats', 'btc')
 * @property {'symbol'|'name'|'none'} [currencyDisplay] - How to display the currency
 *   - 'symbol': Show currency symbol (e.g., '$', '₿', 'ṩ')
 *   - 'name': Show currency name (e.g., 'USD', 'sats')
 *   - 'none': Show only the formatted number
 * @property {boolean} [useUserPreference] - Use user's display preference for sats (BTC vs sats display)
 *
 * @example
 * const options: FormatAmountOptions = {
 *   displayAs: 'usd',
 *   currencyDisplay: 'symbol',
 *   useUserPreference: true
 * };
 */
export interface FormatAmountOptions {
  displayAs?: string;
  currencyDisplay?: 'symbol' | 'name' | 'none';
  useUserPreference?: boolean;
}

/**
 * Currency symbols mapping for display formatting
 *
 * Maps currency unit codes to their respective display symbols.
 * Used when currencyDisplay is set to 'symbol'.
 * Only includes currencies actually used in the application.
 */
const SYMBOLS: Record<string, string> = {
  usd: '$',
  eur: '€',
  gbp: '£',
  btc: '₿',
  sats: 'ṩ',
};

/**
 * List of fiat currency units that require special handling
 *
 * These currencies are treated differently in conversion calculations
 * and display formatting compared to cryptocurrency units.
 * Only includes currencies actually used in the application.
 */
const FIAT_UNITS = ['usd', 'eur', 'gbp'];

/**
 * Retrieves the current exchange rate for a given currency unit
 *
 * This function fetches real-time exchange rates from the Redux store
 * and provides fallback rates for currencies not available in the pricelist.
 * All rates are normalized to BTC as the base currency.
 *
 * @param {string} unit - The currency unit to get the rate for
 * @returns {number} The exchange rate relative to BTC
 *
 * @example
 * const btcRate = getRate('btc'); // Returns 1
 * const satsRate = getRate('sats'); // Returns 100_000_000
 * const usdRate = getRate('usd'); // Returns current USD/BTC rate
 *
 * @private
 */
function getRate(unit: string): number {
  const pricelist = memoizedPricelist(store.getState());
  const rates: Record<string, number> = {
    btc: 1,
    sats: 100_000_000,
    usd: pricelist?.usd?.btc ?? 63_900,
    eur: 53_500,
    gbp: 47_800,
  };
  return rates[unit] ?? 1;
}

/**
 * Formats a monetary amount with appropriate currency display
 *
 * This is the main function for formatting currency amounts throughout the application.
 * It handles unit conversion, precision formatting, and various display modes.
 * Supports both cryptocurrency (BTC, sats) and fiat currencies (USD, EUR, etc.).
 *
 * @param {AmountWithUnit} input - The amount and unit to format
 * @param {FormatAmountOptions} [options={}] - Formatting options
 * @returns {string} The formatted currency string
 *
 * @example
 * // Basic formatting
 * formatAmount({ amount: 1000, unit: 'sats' }); // "1,000"
 *
 * // With user preference (respects user's BTC/sats display setting)
 * formatAmount({ amount: 1000, unit: 'sats' }, { useUserPreference: true });
 *
 * // Convert to different unit
 * formatAmount({ amount: 1000, unit: 'sats' }, { displayAs: 'usd' }); // "$0.01"
 *
 * // With currency symbol
 * formatAmount({ amount: 25.50, unit: 'usd' }, { currencyDisplay: 'symbol' }); // "$25.50"
 *
 * // With currency name
 * formatAmount({ amount: 1000, unit: 'sats' }, { currencyDisplay: 'name' }); // "1,000 sats"
 *
 * @throws {Error} May throw errors if invalid units are provided or conversion fails
 */
export function formatAmount(input: AmountWithUnit, options: FormatAmountOptions = {}): string {
  // Normalize input unit (handle 'sat' -> 'sats' conversion)
  const inputUnit = input.unit.toLowerCase() === 'sat' ? 'sats' : input.unit.toLowerCase();
  const outputUnit = options.displayAs?.toLowerCase() || inputUnit;

  // Handle user preference for sats display (BTC vs sats)
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
