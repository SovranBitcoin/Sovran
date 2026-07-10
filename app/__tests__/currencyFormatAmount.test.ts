/**
 * @jest-environment node
 */

import * as fc from 'fast-check';
import { formatAmount } from '@/shared/lib/currency';

let mockDisplayBtc = 3;
const mockWarn = jest.fn();

jest.mock('@/shared/stores/global/pricelistStore', () => ({
  usePricelistStore: { getState: () => ({ pricelist: null }) },
}));

jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ getDisplayBtc: () => mockDisplayBtc }),
  },
}));

jest.mock('@/shared/lib/logger', () => ({
  cashuLog: { warn: (...args: unknown[]) => mockWarn(...args) },
}));

describe('formatAmount', () => {
  beforeEach(() => {
    mockDisplayBtc = 3;
    mockWarn.mockReset();
  });

  it('treats fiat amounts as minor units while sats remain whole units', () => {
    expect(formatAmount({ amount: 12_345, unit: 'usd' })).toBe('$123.45');
    expect(formatAmount({ amount: 500, unit: 'sats' })).toBe('500');
    expect(formatAmount({ amount: 500, unit: 'sat' })).toBe('500');
  });

  it.each([
    [0, '0.00000500'],
    [1, '500'],
    [2, '500 sats'],
    [3, '500'],
  ] as const)('honors displayBtc mode %i', (displayBtc, expected) => {
    mockDisplayBtc = displayBtc;

    expect(formatAmount({ amount: 500, unit: 'sat' }, { useUserPreference: true })).toBe(expected);
  });

  it('supports name and no-unit output modes', () => {
    expect(formatAmount({ amount: 12_345, unit: 'usd' }, { currencyDisplay: 'name' })).toBe(
      '123.45 usd'
    );
    expect(formatAmount({ amount: 12_345, unit: 'usd' }, { currencyDisplay: 'none' })).toBe(
      '123.45'
    );
  });

  it('fails soft and warns when the requested output unit is unknown', () => {
    expect(formatAmount({ amount: 100, unit: 'sats' }, { displayAs: 'widgets' })).toBe('0.00');
    expect(mockWarn).toHaveBeenCalledWith('currency.rate.unknown_unit', {
      unit: 'widgets',
      hasPricelist: false,
    });
  });

  it('never renders a decimal for integer sats in sats mode', () => {
    mockDisplayBtc = 2;

    fc.assert(
      fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), (amount) => {
        const formatted = formatAmount({ amount, unit: 'sat' }, { useUserPreference: true });
        expect(formatted).toMatch(/^[\d,]+ sats$/);
        expect(formatted).not.toContain('.');
      }),
      { numRuns: 100 }
    );
  });
});
