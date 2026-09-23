/**
 * @jest-environment node
 *
 * Mint-supplied strings index the rail and feature name tables. A mint that
 * advertises a method or NUT called `constructor` must not walk into
 * `Object.prototype` — the result is a function, which `??` does not catch.
 */

import { railName } from '@/features/mint/lib/mintChanges/interpret';

describe('railName with prototype-shaped input', () => {
  it.each(['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty'])(
    'returns the method itself for %s, never an inherited value',
    (method) => {
      const result = railName(method);
      expect(typeof result).toBe('string');
      expect(result).toBe(method);
    }
  );

  it('still resolves a real rail', () => {
    expect(railName('onchain')).toBe('Onchain');
  });
});
