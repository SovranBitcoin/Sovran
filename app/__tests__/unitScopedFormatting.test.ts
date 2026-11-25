/**
 * @jest-environment node
 *
 * Amounts shown per unit: a mint's balances in every unit it holds, and the
 * fiat estimate under a sat balance while no price has loaded.
 */
import { approximateFiatText, formatUnitBalances } from '@/shared/lib/currency';

jest.mock('@/shared/stores/global/pricelistStore', () => ({
  usePricelistStore: { getState: () => ({ pricelist: null }) },
}));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ displayBtc: 2 }) },
}));
jest.mock('@/shared/lib/logger', () => ({ cashuLog: { warn: jest.fn() } }));

describe('formatUnitBalances', () => {
  it('names every unit the mint holds, not sats for all of it', () => {
    expect(formatUnitBalances({ sat: { total: 1500 }, usd: { total: 325 } })).toBe(
      '1,500 sats · $3.25'
    );
  });

  it('leaves out empty units and falls back to 0 sats', () => {
    expect(formatUnitBalances({ sat: { total: 0 }, eur: { total: 120 } })).toBe('€1.20');
    expect(formatUnitBalances({ sat: { total: 0 } })).toBe('0 sats');
    expect(formatUnitBalances({})).toBe('0 sats');
    expect(formatUnitBalances(undefined)).toBe('0 sats');
  });
});

describe('approximateFiatText', () => {
  it('converts with a price', () => {
    expect(approximateFiatText(100_000, 50_000, '$')).toBe('≈ $50.00');
  });

  it('shows a dash, not $0.00, for a balance while the price is unknown', () => {
    expect(approximateFiatText(100_000, undefined, '$')).toBe('≈ —');
    expect(approximateFiatText(100_000, 0, '$')).toBe('≈ —');
  });

  it('shows zero for an empty wallet with or without a price', () => {
    expect(approximateFiatText(0, undefined, '$')).toBe('≈ $0.00');
    expect(approximateFiatText(0, 50_000, '€')).toBe('≈ €0.00');
  });
});
