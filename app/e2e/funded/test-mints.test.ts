import { describe, expect, it } from 'bun:test';

import { isValuelessTestMint, VALUELESS_TEST_MINT_HOSTS } from './test-mints';

describe('valueless test mints', () => {
  it.each(['https://testnut.cashu.space', 'https://nofees.testnut.cashu.space'])(
    'treats %s as valueless',
    (mintUrl) => {
      expect(isValuelessTestMint(mintUrl)).toBe(true);
    }
  );

  it.each([
    'https://mint.sovran.money',
    'https://mint.minibits.cash/Bitcoin',
    // host must match exactly — a lookalike path or subdomain trick is real money
    'https://evil.example/testnut.cashu.space',
    'https://testnut.cashu.space.evil.example',
    'not-a-url',
  ])('keeps %s under the custody guarantee', (mintUrl) => {
    expect(isValuelessTestMint(mintUrl)).toBe(false);
  });

  it('pins the allowlist so additions are deliberate', () => {
    expect([...VALUELESS_TEST_MINT_HOSTS].sort()).toEqual([
      'nofees.testnut.cashu.space',
      'testnut.cashu.space',
    ]);
  });
});
