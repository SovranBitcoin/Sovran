import { extractAvailableCurrencies } from '@/features/mint/lib/availableCurrencies';

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
