/**
 * @jest-environment node
 *
 * The cipher-decode frame function behind `ScrambleText`: settles left → right
 * with progress, holds stable glyphs within a tick, re-rolls between ticks.
 */

import { scrambleFrame } from '@/shared/lib/scrambleText';

describe('scrambleFrame', () => {
  it('scrambles every glyph at progress 0 and settles all at progress 1', () => {
    const target = 'bc1pxyz...abcd';
    const noisy = scrambleFrame(target, target.length, 7, 0);
    expect(noisy).toHaveLength(target.length);
    expect(noisy).not.toBe(target);
    expect(scrambleFrame(target, target.length, 7, 1)).toBe(target);
  });

  it('settles left → right in proportion to progress', () => {
    const target = 'abcdefghij';
    const half = scrambleFrame(target, 10, 3, 0.5);
    expect(half.slice(0, 5)).toBe('abcde');
    expect(half.slice(5)).toHaveLength(5);
    expect(half.slice(5)).toMatch(/^[a-z0-9]{5}$/);
  });

  it('is stable within a tick and changes between ticks', () => {
    expect(scrambleFrame('', 20, 5, 0)).toBe(scrambleFrame('', 20, 5, 0));
    expect(scrambleFrame('', 20, 5, 0)).not.toBe(scrambleFrame('', 20, 6, 0));
    // Neighbouring glyphs differ: the hash must not repeat one character.
    expect(new Set(scrambleFrame('', 30, 5, 0)).size).toBeGreaterThan(5);
  });

  it('keeps spaces so word shapes hold while decoding', () => {
    expect(scrambleFrame('npub abc', 8, 1, 0)[4]).toBe(' ');
  });

  it('draws `length` glyphs while no target is known', () => {
    expect(scrambleFrame('', 23, 0, 0)).toHaveLength(23);
  });
});
