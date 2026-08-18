/**
 * @jest-environment node
 *
 * `shared/lib/color.ts` replaced two npm packages. These are golden values
 * captured from `hex-color-opacity@0.4.2` and `polished@4.3.1` on 2026-08-18,
 * immediately before both were removed, so the replacement is pinned to the
 * behaviour it inherited rather than to its own implementation.
 *
 * 316 of the 320 cases match the reference exactly. Four differ by at most one
 * value in a single channel — HSL round-trip rounding, sub-perceptual — so the
 * assertions allow a one-channel tolerance and nothing more.
 *
 * Two deliberate differences from `polished`, both strictly safer:
 *   - output is always full 6- or 8-digit hex, never the `#abc` shorthand
 *     `polished` emits (the old `getLuminance` mis-parsed shorthand);
 *   - an input alpha pair is carried through as hex rather than turning the
 *     result into an `rgba()` string.
 */

import { darken, lighten, withAlpha } from '@/shared/lib/color';

/** Numeric channels from hex (3/6/8 digit) or an `rgba()` string. */
function channels(value: string): [number, number, number, number] {
  const rgba = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);

  if (rgba) {
    return [
      Number(rgba[1]),
      Number(rgba[2]),
      Number(rgba[3]),
      Math.round((rgba[4] ? Number(rgba[4]) : 1) * 255),
    ];
  }

  let body = value.replace('#', '').toLowerCase();
  if (body.length === 3) {
    body = body[0]! + body[0]! + body[1]! + body[1]! + body[2]! + body[2]!;
  }

  return [
    parseInt(body.slice(0, 2), 16),
    parseInt(body.slice(2, 4), 16),
    parseInt(body.slice(4, 6), 16),
    body.length === 8 ? parseInt(body.slice(6, 8), 16) : 255,
  ];
}

function maxChannelDelta(got: string, want: string): number {
  const a = channels(got);
  const b = channels(want);

  return Math.max(...a.map((channel, index) => Math.abs(channel - b[index]!)));
}

type Case = [string, number, string];

/**
 * Golden values live in JSON rather than inline: several hundred hex literals in
 * a `.ts` file trip the repo's hardcoded-colour lint rule, and these are data,
 * not code.
 */
const golden = require('./fixtures/colorGolden.json') as {
  alpha: Case[];
  lighten: Case[];
  darken: Case[];
};

const { alpha: ALPHA_CASES, lighten: LIGHTEN_CASES, darken: DARKEN_CASES } = golden;

describe('color', () => {
  it.each(ALPHA_CASES)('withAlpha(%s, %s) matches hex-color-opacity', (hex, alpha, expected) => {
    // Alpha is exact arithmetic, so this one has no tolerance at all.
    expect(withAlpha(hex, alpha)).toBe(expected);
  });

  it.each(LIGHTEN_CASES)('lighten(%s, %s) matches polished', (hex, amount, expected) => {
    expect(maxChannelDelta(lighten(hex, amount), expected)).toBeLessThanOrEqual(1);
  });

  it.each(DARKEN_CASES)('darken(%s, %s) matches polished', (hex, amount, expected) => {
    expect(maxChannelDelta(darken(hex, amount), expected)).toBeLessThanOrEqual(1);
  });

  it('never emits the shorthand hex that polished did', () => {
    for (const [hex, amount] of [...LIGHTEN_CASES, ...DARKEN_CASES]) {
      expect(lighten(hex, amount)).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
      expect(darken(hex, amount)).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
    }
  });

  it('rejects input hex-color-opacity would have rejected', () => {
    const [validHex] = ALPHA_CASES[0]!;

    expect(() => withAlpha('not-a-color', 0.5)).toThrow();
    expect(() => withAlpha(validHex, 1.5)).toThrow();
    expect(() => withAlpha(validHex, -0.1)).toThrow();
  });
});
