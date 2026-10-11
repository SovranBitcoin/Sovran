import { describe, expect, it } from 'vitest';

import { amountToNumber, amountToNumberOrUndefined, requireAmount } from '../../src/amount';

const unsafe = BigInt(Number.MAX_SAFE_INTEGER) * 2n;

describe('amountToNumber (display)', () => {
  it('converts every shape coco hands out', () => {
    expect(amountToNumber(42)).toBe(42);
    expect(amountToNumber(7n)).toBe(7);
    expect(amountToNumber('21')).toBe(21);
    expect(amountToNumber({ toNumber: () => 5 })).toBe(5);
    expect(amountToNumber(-3)).toBe(-3);
  });

  it('shows zero for a missing or unreadable amount, never NaN', () => {
    for (const bad of [null, undefined, 'not-a-number', '', ' ', NaN, Infinity]) {
      expect(amountToNumber(bad)).toBe(0);
    }
    expect(amountToNumber({ toNumber: () => NaN })).toBe(0);
    expect(amountToNumber({} as never)).toBe(0);
    expect(
      amountToNumber({
        toNumber: () => {
          throw new Error('exceeds Number.MAX_SAFE_INTEGER');
        },
      })
    ).toBe(0);
  });
});

describe('amountToNumberOrUndefined', () => {
  it('keeps unknown apart from zero', () => {
    expect(amountToNumberOrUndefined(0)).toBe(0);
    expect(amountToNumberOrUndefined('0')).toBe(0);
    for (const unknown of [null, undefined, 'abc', '', NaN]) {
      expect(amountToNumberOrUndefined(unknown)).toBeUndefined();
    }
  });
});

describe('requireAmount (prices, fees and amounts to pay or accept)', () => {
  it('returns a whole, non-negative, safe amount', () => {
    expect(requireAmount(0)).toBe(0);
    expect(requireAmount('21')).toBe(21);
    expect(requireAmount(7n)).toBe(7);
    expect(requireAmount({ toNumber: () => 5 })).toBe(5);
  });

  it('refuses to invent a number', () => {
    for (const bad of [null, undefined, 'abc', '', NaN, Infinity, -1, 1.5, '1.5', unsafe, '1e3', '0x10', ' 21 ']) {
      expect(() => requireAmount(bad)).toThrow(TypeError);
    }
  });
});
