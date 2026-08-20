/**
 * @jest-environment node
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import { getUsername } from '@/shared/lib/username';

describe('getUsername compatibility', () => {
  it.each([
    ['', 'whistling-robin'],
    ['0', 'far-turaco'],
    ['abc', 'swooping-asteroid'],
    ['hello world', 'tackling-shrike'],
    ['éclair', 'surveying-oriole'],
    ['🔐', 'endless-egret'],
    ['0'.repeat(64), 'keeping-lightning'],
    ['f'.repeat(64), 'calm-mockingbird'],
    ['17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917', 'napping-cloud'],
    ['d977a6cf0f831dc4720780b5f51460eaf6dca08e32d1f6e89b60344d63af4e04', 'reaching-valley'],
  ])('keeps the seeded mapping for %p', (seed, expected) => {
    expect(getUsername(seed)).toBe(expected);
  });

  it('keeps the seeded mapping across a broad compatibility corpus', () => {
    const corpus = Array.from({ length: 4096 }, (_, index) =>
      getUsername(`sovran-username-compat-${index}`)
    ).join('\n');

    expect(bytesToHex(sha256(utf8ToBytes(corpus)))).toBe(
      '2532a5bf7954b3ffc5d772a9807fe2d62c5820a421ed23d0e6f381c38ec4cc92'
    );
  });

  it('preserves the upstream runtime string coercion', () => {
    expect(getUsername(0 as unknown as string)).toBe(getUsername('0'));
  });

  it('does not consume runtime entropy for deterministic display labels', () => {
    const random = jest.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('runtime entropy must not be used');
    });

    try {
      expect(getUsername('public-seed')).toBe('bushy-quasar');
    } finally {
      random.mockRestore();
    }
  });
});
