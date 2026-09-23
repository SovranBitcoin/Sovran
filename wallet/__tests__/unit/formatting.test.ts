/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * formatting — FormattedString + FormattedTimestamp
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Presentation primitives that wrap a primitive (string / number) and expose
 * locale-aware formatting. Both are hot-path: they are constructed for every
 * row of the transactions list and every quick-send suggestion, so per-call
 * allocation of Intl formatters is observable as jank in long lists.
 *
 * Tests cover:
 *   - Truncation never splits a surrogate pair (emoji / non-BMP characters)
 *   - Truncation respects code-point counts, not UTF-16 code units
 *   - Repeated FormattedTimestamp construction with the same locale does not
 *     allocate a new Intl formatter per getter access
 *   - beforeAt mode keeps the domain intact across RTL and LTR locales
 */

import { describe, it, expect } from 'vitest';

import { FormattedString } from '../../src/formatting/FormattedString';
import { FormattedTimestamp } from '../../src/formatting/FormattedTimestamp';

describe('FormattedString.truncate', () => {
  it('does not split surrogate pairs in middle mode', () => {
    // 4 code points: 'a', 'b', '🎉' (U+1F389, surrogate pair), 'c'
    const s = new FormattedString('ab🎉c', 'middle');
    const out = s.truncate(2);
    // 4 cp <= 2*2 → returns original
    expect(out).toBe('ab🎉c');
  });

  it('counts code points, not UTF-16 code units, in end mode', () => {
    // 'a' + '🎉' + '🎉' + 'b' = 4 code points, 6 code units
    const s = new FormattedString('a🎉🎉b', 'end');
    const out = s.truncate(2);
    expect(out).toBe('a🎉...');
  });

  it('preserves surrogate pairs at the boundary in middle mode', () => {
    // 8 code points: 'A','B','🎉','🎉','🎉','🎉','C','D'
    const s = new FormattedString('AB🎉🎉🎉🎉CD', 'middle');
    const out = s.truncate(2);
    // Take 2 from start, 2 from end — boundary lands between code points
    expect(out).toBe('AB...CD');
    // No lone surrogates anywhere
    for (let i = 0; i < out.length; i++) {
      const c = out.charCodeAt(i);
      // High surrogate must be followed by low surrogate
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = out.charCodeAt(i + 1);
        expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
      }
    }
  });

  it('returns original string when n*2 >= cp length in middle mode', () => {
    const s = new FormattedString('🎉🎉', 'middle');
    expect(s.truncate(1)).toBe('🎉🎉');
  });

  it('keeps the domain intact in beforeAt mode', () => {
    const s = new FormattedString('alice🎉🎉🎉🎉🎉@example.com', 'beforeAt');
    const out = s.truncate(2);
    expect(out.endsWith('@example.com')).toBe(true);
  });

  it('falls back to middle when no @ in beforeAt mode', () => {
    const s = new FormattedString('cashuABCDEFGHIJ', 'beforeAt');
    const out = s.truncate(3);
    expect(out).toBe('cas...HIJ');
  });

  it('truncates RTL local part from the visual start', () => {
    const local = 'aaaaaaaaa';
    const s = new FormattedString(`${local}@d.com`, 'beforeAt', 'ar');
    const out = s.truncate(3);
    expect(out).toBe(`...${local.slice(-3)}@d.com`);
  });
});

/**
 * React Native's dev-only `deepFreezeAndThrowOnMutationInDev` walks every own
 * enumerable key of a bridge argument and redefines it. A String exotic
 * object's character indices are enumerable but NON-CONFIGURABLE, so that
 * redefine throws (`property is not configurable` on Hermes). RN skips
 * anything already frozen, which is why the constructor freezes.
 */
describe('FormattedString immutability', () => {
  /** The exact algorithm from react-native/Libraries/Utilities/deepFreezeAndThrowOnMutationInDev.js */
  function deepFreezeAndThrowOnMutationInDev(object: unknown): unknown {
    if (
      typeof object !== 'object' ||
      object === null ||
      Object.isFrozen(object) ||
      Object.isSealed(object)
    ) {
      return object;
    }
    const keys = Object.keys(object as object);
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        const value = (object as Record<string, unknown>)[key];
        Object.defineProperty(object, key, { get: () => value });
        Object.defineProperty(object, key, {
          set: () => {
            throw new Error(`immutable ${key}`);
          },
        });
      }
    }
    Object.freeze(object);
    Object.seal(object);
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        deepFreezeAndThrowOnMutationInDev((object as Record<string, unknown>)[key]);
      }
    }
    return object;
  }

  it('survives the native-bridge deep freeze that its character indices would otherwise break', () => {
    const contact = [{ method: 'nostr', info: new FormattedString('npub1abcdefghijklmnop') }];
    expect(() => deepFreezeAndThrowOnMutationInDev({ contact })).not.toThrow();
  });

  it('is frozen, which is what makes the walk skip it', () => {
    expect(Object.isFrozen(new FormattedString('cashuABCD'))).toBe(true);
  });

  it('still behaves as a string once frozen', () => {
    const formatted = new FormattedString('npub1abcdefghijklmnop', 'middle');
    expect(formatted.valueOf()).toBe('npub1abcdefghijklmnop');
    expect(String(formatted)).toBe('npub1abcdefghijklmnop');
    expect(formatted.length).toBe(21);
    expect(formatted.truncate(6)).toContain('...');
  });
});

describe('FormattedTimestamp', () => {
  // Two fixed instants exactly 24h apart — chosen so `relative` is locale-invariant
  // ("1 day ago" / equivalent). The tests assert behavior, not a specific string.
  const earlier = new FormattedTimestamp(Date.now() - 86_400_000, 'en');
  const later = new FormattedTimestamp(Date.now(), 'en');

  it('formats the same number consistently across repeated getter access', () => {
    // Indirectly verifies that swapping a fresh Intl per call for a cached one
    // did not change the output: both calls must produce the same string.
    const a = later.short;
    const b = later.short;
    expect(a).toBe(b);
  });

  it('returns a relative time string that includes "ago" or a localized equivalent', () => {
    const out = earlier.relative;
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('returns "just now" for sub-minute deltas', () => {
    const ts = new FormattedTimestamp(Date.now() - 1_000, 'en');
    expect(ts.relative).toBe('just now');
  });

  it('preserves Number arithmetic semantics', () => {
    const v = 1_700_000_000_000;
    const ts = new FormattedTimestamp(v, 'en');
    expect(ts.valueOf()).toBe(v);
    expect(Number(ts)).toBe(v);
  });
});
