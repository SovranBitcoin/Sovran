import { test, expect, describe } from 'bun:test';

import {
  compareVersionStrings,
  sortVersionsNewestFirst,
  sortScreenshotsForListing,
  resolveImageUrl,
} from '../asc.mjs';

describe('asc pure helpers', () => {
  test('compareVersionStrings orders numerically', () => {
    expect(compareVersionStrings('0.1.0', '0.0.62')).toBeGreaterThan(0);
    expect(compareVersionStrings('1.2.0', '1.10.0')).toBeLessThan(0);
    expect(compareVersionStrings('0.1.0', '0.1.0')).toBe(0);
  });

  test('sortVersionsNewestFirst puts the highest version first', () => {
    const out = sortVersionsNewestFirst([
      { attributes: { versionString: '0.0.62' } },
      { attributes: { versionString: '0.1.0' } },
    ]);
    expect(out[0].attributes.versionString).toBe('0.1.0');
  });

  test('sortScreenshotsForListing respects sortOrder when present', () => {
    const out = sortScreenshotsForListing([
      { id: 'b', attributes: { sortOrder: 2 } },
      { id: 'a', attributes: { sortOrder: 1 } },
    ]);
    expect(out.map((s) => s.id)).toEqual(['a', 'b']);
  });

  test('sortScreenshotsForListing leaves order untouched without sortOrder', () => {
    const input = [
      { id: 'x', attributes: {} },
      { id: 'y', attributes: {} },
    ];
    expect(sortScreenshotsForListing(input).map((s) => s.id)).toEqual(['x', 'y']);
  });

  test('resolveImageUrl fills template params', () => {
    expect(resolveImageUrl({ templateUrl: 'https://x/{w}x{h}.{f}', width: 100, height: 200 })).toBe(
      'https://x/100x200.png'
    );
    expect(resolveImageUrl({})).toBeNull();
  });
});
