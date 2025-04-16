
import { store } from "helper/redux/store";
import { memoizedPricelist } from "helper/redux/pricelist";

interface Currency {
  currency: 'BTC' | 'USD' | 'EUR' | 'GBP' | 'AUD' | 'CAD' | 'NZD' | 'KRW';
  value: number;
  denomination: 'btc' | 'sats' | 'sat' | 'bits' | 'finneys' | 'usd' | 'eur' | 'gbp' | 'aud' | 'cad' | 'nzd' | 'krw';
}

interface Options {
  locale: string;
  precision: number;
  currencyDisplay: "symbol" | "code" | "name" | "none";
  denomination: 'btc' | 'sats' | 'bits' | 'finneys' | 'usd' | 'eur' | 'gbp' | 'aud' | 'cad' | 'nzd' | 'krw';
  pricelist?: { [key: string]: number };
}

export function formatCurrency(currency: Currency, options: Options): string {


  // Conversion rates
  const conversionRates: { [key: string]: number } = {
    btc: 1,
    sats: 100_000_000,
    bits: 1_000_000,
    finneys: 100_000,
    usd: memoizedPricelist(store.getState())?.usd?.btc || options.pricelist?.USDT || 63_900,
    eur: options.pricelist?.EUR || 53_500,
    gbp: options.pricelist?.GBP || 47_800,
    aud: 45_000, // Example rate
    cad: 50_000, // Example rate
    nzd: 43_000, // Example rate
    krw: 75_000_000, // Example rate
    mstr: 1, // Example rate
    tsla: 1,
  };

  // Adjust the currency value if the denomination is a fiat currency
  let adjustedCurrencyValue = currency.value;
  if (['usd', 'eur', 'gbp', 'aud', 'cad', 'nzd', 'krw', 'mstr', 'tsla'].includes(currency.denomination)) {
    adjustedCurrencyValue = currency.value / 100;
  }

  // Convert the value to BTC for easier conversion later
  const valueInBTC = adjustedCurrencyValue / conversionRates[currency.denomination];

  // Convert the BTC value to the target denomination
  const valueInTargetDenomination = valueInBTC * conversionRates[options.denomination];

  // Determine the currency display symbol, code, or name
  let currencyDisplay;
  const currencySymbols: { [key: string]: string } = {
    usd: "$",
    eur: "€",
    gbp: "£",
    btc: "₿",
    aud: "A$", // Example symbol
    cad: "C$", // Example symbol
    nzd: "NZ$", // Example symbol
    krw: "₩", // Example symbol
    sat: "ṩ"
  };
  const currencyNames: { [key: string]: string } = {
    usd: "US Dollar",
    eur: "Euro",
    gbp: "British Pound",
    btc: "Bitcoin",
    aud: "Australian Dollar", // Added currency name
    cad: "Canadian Dollar", // Added currency name
    nzd: "New Zealand Dollar", // Added currency name
    krw: "Korean Won", // Added currency name
  };

  switch (options.currencyDisplay) {
    case "symbol":
      currencyDisplay = currencySymbols[options.denomination] || "";
      break;
    case "code":
      currencyDisplay = currency.currency;
      break;
    case "name":
      currencyDisplay = currencyNames[options.denomination] || "";
      break;
    case "none":
      currencyDisplay = "";
      break;
    default:
      currencyDisplay = ""; // Fallback case, though not expected
  }

  // Format the number according to locale and precision
  const formattedNumber = new Intl.NumberFormat(options.locale, {
    minimumFractionDigits: options.precision,
    maximumFractionDigits: options.precision,
  }).format(valueInTargetDenomination);

  // Construct the final string
  const finalString = options.currencyDisplay === "name" ?
    `${formattedNumber} ${options.denomination.toUpperCase() !== 'SATS' ? options.denomination.toUpperCase() : options.denomination}` :
    `${currencyDisplay}${formattedNumber}`;

  return finalString;
}

export const formatCurrencyWrapper = (amount, unit, display = 1) => {
  const display_btc = display ?? 1;
  const currency = unit === "sat" ? "BTC" : unit.toUpperCase();
  const precision = unit === "sat" ? (display_btc === 0 ? 8 : 0) : 2;
  const currencyDisplay =
    unit === "sat" ? (display_btc === 2 ? "name" : "none") : "symbol";
  const denomination =
    unit === "sat" ? (display_btc === 0 ? "btc" : "sats") : unit;
  const value = display_btc === 0 && unit === 'sat' ? amount / 100_000_000 : amount;

  return formatCurrency(
    {
      currency,
      value,
      denomination,
    },
    {
      locale: "en-US",
      precision,
      currencyDisplay,
      denomination,
    }
  );
};