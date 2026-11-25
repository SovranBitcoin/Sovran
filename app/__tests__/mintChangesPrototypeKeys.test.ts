/**
 * @jest-environment node
 *
 * Mint-supplied strings index the rail and feature name tables. A mint that
 * advertises a method or NUT called `constructor` must not walk into
 * `Object.prototype` — the result is a function, which `??` does not catch.
 */

import { railName } from '@/features/mint/lib/mintChanges/interpret';
import { copyEntries, ownEntry, withOwnEntry } from '@/shared/lib/ownEntry';

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

describe('mint-keyed tables with prototype-shaped mint URLs', () => {
  it.each(['constructor', '__proto__', 'tostring', 'hasOwnProperty'])(
    'reads nothing for %s in an empty table',
    (key) => {
      expect(ownEntry({}, key)).toBeUndefined();
    }
  );

  it('writes and copies a __proto__ entry as an own entry, never the prototype', () => {
    const table = withOwnEntry<{ n: number }>({ a: { n: 1 } }, '__proto__', { n: 2 });
    expect(Object.getPrototypeOf(table)).toBe(Object.prototype);
    expect(ownEntry(table, '__proto__')).toEqual({ n: 2 });
    const copy = copyEntries(table);
    expect(Object.keys(copy)).toEqual(['a', '__proto__']);
    expect(ownEntry(copy, '__proto__')).toEqual({ n: 2 });
    // Setting an existing key keeps its place.
    expect(Object.keys(withOwnEntry(table, 'a', { n: 3 }))).toEqual(['a', '__proto__']);
  });
});
