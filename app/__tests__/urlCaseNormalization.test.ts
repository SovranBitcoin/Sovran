import { extractDomain, normalizeMintUrlKey, normalizeUrlForApi } from '@/shared/lib/url';

// iOS sentence-capitalization turns a hand-typed mint URL into "Https://…".
// The scheme is case-insensitive per RFC 3986 — every URL helper must treat it
// that way or a legitimate mint URL fails validation (caught live by the
// mint.add.url e2e run typing into the Add Mints search field).

describe('URL scheme case-insensitivity', () => {
  it('normalizeUrlForApi lowercases a capitalized scheme instead of nesting it', () => {
    expect(normalizeUrlForApi('Https://testnut.cashu.space')).toBe('https://testnut.cashu.space');
    expect(normalizeUrlForApi('HTTP://Mint.Example.com')).toBe('https://mint.example.com');
  });

  it('normalizeUrlForApi keeps path casing while lowercasing the host', () => {
    expect(normalizeUrlForApi('Https://Mint.Minibits.cash/Bitcoin')).toBe(
      'https://mint.minibits.cash/Bitcoin'
    );
  });

  it('normalizeMintUrlKey keys capitalized-scheme URLs identically', () => {
    expect(normalizeMintUrlKey('Https://testnut.cashu.space')).toBe(
      normalizeMintUrlKey('https://testnut.cashu.space')
    );
  });

  it('extractDomain strips a capitalized scheme', () => {
    expect(extractDomain('Https://testnut.cashu.space/path')).toBe('testnut.cashu.space');
  });
});
