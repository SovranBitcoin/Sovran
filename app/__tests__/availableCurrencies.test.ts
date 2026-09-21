import {
  extractAvailableCurrencies,
  filterMintsForCurrencyTab,
} from '@/features/mint/lib/availableCurrencies';

describe('extractAvailableCurrencies', () => {
  it('deduplicates case variants and orders SAT before alphabetical currencies', () => {
    expect(
      extractAvailableCurrencies([
        ['usd', 'sat'],
        ['EUR', 'SAT', 'gbp', 'USD'],
      ])
    ).toEqual(['SAT', 'EUR', 'GBP', 'USD']);
  });

  it('puts testnut account units after the real ones, tBTC leading them', () => {
    expect(
      extractAvailableCurrencies([
        ['tusd', 'sat'],
        ['tsat', 'usd', 'teur'],
      ])
    ).toEqual(['SAT', 'USD', 'TSAT', 'TEUR', 'TUSD']);
  });

  it('leaves discovery restrictions and seeded units to the caller', () => {
    expect(extractAvailableCurrencies([])).toEqual([]);
    expect(extractAvailableCurrencies([[], ['jpy', 'eur']])).toEqual(['EUR', 'JPY']);
  });
});

describe('filterMintsForCurrencyTab', () => {
  type Row = { mintUrl: string; supportedUnits?: string[] };
  const real: Row = { mintUrl: 'real', supportedUnits: ['sat', 'usd'] };
  const testnut: Row = { mintUrl: 'testnut', supportedUnits: ['tsat'] };
  const unknown: Row = { mintUrl: 'unknown' };
  const rows = [real, testnut, unknown];

  it('keeps ALL on the active account side of the testnut split', () => {
    expect(filterMintsForCurrencyTab(rows, 'ALL', false)).toEqual([real, unknown]);
    expect(filterMintsForCurrencyTab(rows, 'ALL', true)).toEqual([testnut, unknown]);
  });

  it('lists a mint across the split only under its own account unit tab', () => {
    expect(filterMintsForCurrencyTab(rows, 'TSAT', false)).toEqual([testnut, unknown]);
    expect(filterMintsForCurrencyTab(rows, 'SAT', true)).toEqual([real, unknown]);
  });

  it('never hides a row whose units are not known yet', () => {
    expect(filterMintsForCurrencyTab([unknown], 'USD', false)).toEqual([unknown]);
  });
});
