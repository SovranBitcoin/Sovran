import { store } from 'helper/redux/store';
import { memoizedPricelist } from 'helper/redux/pricelist';

/**
 * Supported currency codes
 */
export type CurrencyCode = 'BTC' | 'USD' | 'EUR' | 'GBP' | 'AUD' | 'CAD' | 'NZD' | 'KRW';

/**
 * Supported denominations for currency display
 */
export type Denomination =
  | 'btc'
  | 'sats'
  | 'sat'
  | 'bits'
  | 'finneys'
  | 'usd'
  | 'eur'
  | 'gbp'
  | 'aud'
  | 'cad'
  | 'nzd'
  | 'krw';

/**
 * Currency display options
 */
type CurrencyDisplayOption = 'symbol' | 'code' | 'name' | 'none';

/**
 * Currency info with value and denomination
 */
interface Currency {
  currency: CurrencyCode;
  value: number;
  denomination: Denomination;
}

/**
 * Formatting options for currency display
 */
interface FormatOptions {
  locale: string;
  precision: number;
  currencyDisplay: CurrencyDisplayOption;
  denomination: Denomination;
  pricelist?: Record<string, number>;
}

/**
 * Currency symbols mapping
 */
const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  usd: '$',
  eur: '€',
  gbp: '£',
  btc: '₿',
  aud: 'A$',
  cad: 'C$',
  nzd: 'NZ$',
  krw: '₩',
  sat: 'ṩ',
  sats: 'ṩ',
};

/**
 * Currency names mapping
 */
const CURRENCY_NAMES: Readonly<Record<string, string>> = {
  usd: 'US Dollar',
  eur: 'Euro',
  gbp: 'British Pound',
  btc: 'Bitcoin',
  aud: 'Australian Dollar',
  cad: 'Canadian Dollar',
  nzd: 'New Zealand Dollar',
  krw: 'Korean Won',
  sat: 'Satoshi',
  sats: 'Satoshis',
  bits: 'Bits',
  finneys: 'Finneys',
};

/**
 * List of fiat currencies
 */
const FIAT_CURRENCIES = ['usd', 'eur', 'gbp', 'aud', 'cad', 'nzd', 'krw', 'mstr', 'tsla'];

/**
 * Formats a currency value based on provided options
 * @param currency - The currency to format
 * @param options - Formatting options
 * @returns Formatted currency string
 */
export function formatCurrency(currency: Currency, options: FormatOptions): string {
  // Get current prices from store or fallback to provided pricelist or defaults
  const currentPricelist = memoizedPricelist(store.getState());

  // Conversion rates
  const conversionRates: Record<string, number> = {
    btc: 1,
    sats: 100_000_000,
    sat: 100_000_000,
    bits: 1_000_000,
    finneys: 100_000,
    usd: currentPricelist?.usd?.btc ?? options.pricelist?.USDT ?? 63_900,
    eur: options.pricelist?.EUR ?? 53_500,
    gbp: options.pricelist?.GBP ?? 47_800,
    aud: options.pricelist?.AUD ?? 45_000,
    cad: options.pricelist?.CAD ?? 50_000,
    nzd: options.pricelist?.NZD ?? 43_000,
    krw: options.pricelist?.KRW ?? 75_000_000,
    mstr: 1,
    tsla: 1,
  };

  // Adjust the currency value if the denomination is a fiat currency
  const adjustedCurrencyValue = FIAT_CURRENCIES.includes(currency.denomination)
    ? currency.value / 100
    : currency.value;

  // Convert the value to BTC for easier conversion later
  const valueInBTC = adjustedCurrencyValue / conversionRates[currency.denomination];

  // Convert the BTC value to the target denomination
  const valueInTargetDenomination = valueInBTC * conversionRates[options.denomination];

  // Determine the currency display (symbol, code, name, or none)
  let currencyDisplay = '';

  switch (options.currencyDisplay) {
    case 'symbol':
      currencyDisplay = CURRENCY_SYMBOLS[options.denomination] ?? '';
      break;
    case 'code':
      currencyDisplay = currency.currency;
      break;
    case 'name':
      currencyDisplay = CURRENCY_NAMES[options.denomination] ?? '';
      break;
    // No need for default as currencyDisplay is already initialized to empty string
  }

  // Format the number according to locale and precision
  const formattedNumber = new Intl.NumberFormat(options.locale, {
    minimumFractionDigits: options.precision,
    maximumFractionDigits: options.precision,
  }).format(valueInTargetDenomination);

  // Construct the final string
  if (options.currencyDisplay === 'name') {
    const denomDisplay =
      options.denomination.toUpperCase() !== 'SATS'
        ? options.denomination.toUpperCase()
        : options.denomination;
    return `${formattedNumber} ${denomDisplay}`;
  }

  return `${currencyDisplay}${formattedNumber}`;
}

/**
 * Simplified wrapper for formatCurrency with sensible defaults
 * @param amount - Amount to format
 * @param unit - Currency unit (e.g., 'sat', 'usd')
 * @param display - Display style: 0 (BTC value), 1 (default - sats with no symbol), 2 (sats with name), 3 (sats with BTC icon)
 * @returns Formatted currency string
 */
export const formatCurrencyWrapper = (amount: number, unit: string, display = 1): string => {
  const display_btc = display ?? 1;
  const currency = unit === 'sat' ? 'BTC' : (unit.toUpperCase() as CurrencyCode);
  const precision = unit === 'sat' ? (display_btc === 0 ? 8 : 0) : 2;
  const currencyDisplay =
    unit === 'sat' ? (display_btc === 2 ? 'name' : 'none') : ('symbol' as CurrencyDisplayOption);
  const denomination =
    unit === 'sat' ? (display_btc === 0 ? 'btc' : 'sats') : (unit as Denomination);
  const value = display_btc === 0 && unit === 'sat' ? amount / 100_000_000 : amount;

  return formatCurrency(
    {
      currency,
      value,
      denomination,
    },
    {
      locale: 'en-US',
      precision,
      currencyDisplay,
      denomination,
    }
  );
};

/**
 * Format an amount using the user's display preferences
 */
export const formatAmount = (amount: number, unit: string): string => {
  const display_btc = store.getState().settings.settings.display_btc ?? 1;
  return formatCurrencyWrapper(amount, unit, display_btc);
};
