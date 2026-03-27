/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * normalize.ts — Input Normalization
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * These tests cover the lowest layer of the parsing pipeline: string
 * normalization. Before any payment format detection happens, every input
 * passes through these functions to:
 *
 *   1. Remove invisible characters (zero-width joiners, BOM) that sneak in
 *      from copy-paste on mobile devices.
 *   2. Strip payment-specific URI prefixes (cashu:, lightning:, etc.) so
 *      the detection layer sees the raw payload.
 *   3. URI-decode strings that were percent-encoded (e.g. QR codes that
 *      encode special characters).
 *   4. Generate all plausible "variants" of an input — the parser tries
 *      each variant against each detector, so a single paste can match
 *      even if it's prefixed or encoded.
 *
 * Why this matters: users scan QR codes, paste from clipboards, and click
 * deep links. Each source may add different prefixes or encodings. The
 * normalization layer ensures the parser works regardless of the source.
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeInput,
  safeDecodeURIComponent,
  stripPrefixes,
  stripGenericPrefixes,
  stripLightningPrefixes,
  stripCashuPrefixes,
  inputVariants,
} from '../../src/normalize';

// ---------------------------------------------------------------------------
// sanitizeInput
// ---------------------------------------------------------------------------

/**
 * sanitizeInput is the first function called on every input string.
 * It removes zero-width Unicode characters and trims whitespace.
 *
 * Zero-width characters (\u200B-\u200D, \uFEFF) are invisible but can
 * break string matching. They commonly appear when:
 *   - Users copy text from web pages or messaging apps
 *   - The system clipboard adds a BOM (Byte Order Mark) prefix
 *   - Mobile keyboards insert zero-width joiners between emoji
 */
describe('sanitizeInput', () => {
  it('trims whitespace', () => {
    // Leading/trailing spaces are common from sloppy copy-paste
    expect(sanitizeInput('  hello  ')).toBe('hello');
  });

  it('removes zero-width characters', () => {
    // \u200B = zero-width space — invisible but breaks === comparison
    expect(sanitizeInput('he\u200Bllo')).toBe('hello');
    // \u200C = zero-width non-joiner — found in some Asian text
    expect(sanitizeInput('he\u200Cllo')).toBe('hello');
    // \u200D = zero-width joiner — used between emoji sequences
    expect(sanitizeInput('he\u200Dllo')).toBe('hello');
  });

  it('removes BOM', () => {
    // \uFEFF = Byte Order Mark — prepended by some text editors and
    // clipboard implementations. If not stripped, "cashuA..." would
    // fail the cashu-ts decoder because of the hidden leading byte.
    expect(sanitizeInput('\uFEFFhello')).toBe('hello');
  });

  it('handles combined whitespace, zero-width, and BOM', () => {
    // Real-world worst case: user copies a token from a web page that
    // has BOM + zero-width space + regular whitespace all mixed in
    expect(sanitizeInput('  \uFEFF\u200Bhello\u200C  ')).toBe('hello');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeInput('')).toBe('');
    // Whitespace-only input normalizes to empty — the parser treats
    // this as "no input" and returns an error
    expect(sanitizeInput('   ')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// safeDecodeURIComponent
// ---------------------------------------------------------------------------

/**
 * safeDecodeURIComponent wraps decodeURIComponent with error handling.
 *
 * QR codes and deep links sometimes percent-encode special characters.
 * For example, a BIP-321 URI like `bitcoin:?lightning=lnbc%3A1u1p0test`
 * needs decoding before the lightning invoice can be detected.
 *
 * If the string contains invalid encoding (like `%ZZ`), the standard
 * decodeURIComponent throws — this wrapper returns the original instead,
 * so parsing continues with the un-decoded value.
 */
describe('safeDecodeURIComponent', () => {
  it('decodes valid URI components', () => {
    // %20 = space — standard URI encoding
    expect(safeDecodeURIComponent('hello%20world')).toBe('hello world');
  });

  it('returns original on invalid URI encoding', () => {
    // %ZZ is not valid hex — decodeURIComponent would throw URIError.
    // The safe wrapper catches it and returns the original string,
    // allowing parsing to continue with the raw value.
    expect(safeDecodeURIComponent('%ZZ')).toBe('%ZZ');
  });

  it('passes through plain strings', () => {
    // No percent signs = nothing to decode, returns as-is
    expect(safeDecodeURIComponent('hello')).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// stripPrefixes
// ---------------------------------------------------------------------------

/**
 * stripPrefixes is the core prefix-removal engine. It takes a value and
 * an array of prefixes, then iteratively removes any matching prefix
 * (case-insensitive) until none remain.
 *
 * The iterative approach handles double-prefixed strings like
 * `lightning:lightning:lnbc...` which appear when a wallet wraps an
 * already-prefixed invoice in a deep link.
 */
describe('stripPrefixes', () => {
  it('strips a matching prefix (case-insensitive)', () => {
    // lowercase prefix on uppercase input — must be case-insensitive
    // because QR code generators and apps use inconsistent casing
    expect(stripPrefixes('lightning:lnbc1...', ['lightning:'])).toBe('lnbc1...');
    expect(stripPrefixes('LIGHTNING:lnbc1...', ['lightning:'])).toBe('lnbc1...');
  });

  it('strips double prefixes iteratively', () => {
    // This happens when a wallet creates a deep link from an invoice
    // that already has a lightning: prefix, producing
    // `lightning:lightning:lnbc...`. Without iterative stripping, the
    // inner prefix would remain and break invoice detection.
    expect(stripPrefixes('lightning:lightning:lnbc1...', ['lightning:'])).toBe('lnbc1...');
  });

  it('returns the original when no prefix matches', () => {
    // If the string doesn't start with any known prefix, return as-is
    expect(stripPrefixes('lnbc1...', ['lightning:'])).toBe('lnbc1...');
  });

  it('sanitizes the input (trims, removes zero-width)', () => {
    // stripPrefixes calls sanitizeInput first, so whitespace and
    // invisible chars around the prefix are handled automatically
    expect(stripPrefixes('  \u200Blightning:lnbc1  ', ['lightning:'])).toBe('lnbc1');
  });
});

// ---------------------------------------------------------------------------
// stripGenericPrefixes
// ---------------------------------------------------------------------------

/**
 * stripGenericPrefixes removes ALL known payment prefixes:
 *   cashu://, cashu:, lightning://, lightning:, lightning=
 *
 * Used by inputVariants() to generate a "fully stripped" variant
 * that the detection layer tries against all format detectors.
 */
describe('stripGenericPrefixes', () => {
  it.each([
    // cashu:// — used by some cashu wallet deep links
    ['cashu://cashuA...', 'cashuA...'],
    // cashu: — NUT-XX standard prefix
    ['cashu:cashuA...', 'cashuA...'],
    // lightning:// — iOS deep link format
    ['lightning://lnbc1...', 'lnbc1...'],
    // lightning: — Android/standard deep link format
    ['lightning:lnbc1...', 'lnbc1...'],
    // lightning= — appears as a BIP-321 query parameter value
    ['lightning=lnbc1...', 'lnbc1...'],
  ])('strips generic prefix from %s', (input, expected) => {
    expect(stripGenericPrefixes(input)).toBe(expected);
  });

  it('strips mixed double prefixes', () => {
    // cashu:// wrapping cashu: — both get stripped iteratively
    expect(stripGenericPrefixes('cashu://cashu:cashuA...')).toBe('cashuA...');
  });
});

// ---------------------------------------------------------------------------
// stripLightningPrefixes
// ---------------------------------------------------------------------------

/**
 * stripLightningPrefixes removes only Lightning-specific prefixes.
 * Used when the parser already knows it's looking at a Lightning context
 * (e.g. inside a BIP-321 `lightning=` parameter).
 *
 * Critically, it must NOT strip cashu: prefixes — those are for a
 * different protocol.
 */
describe('stripLightningPrefixes', () => {
  it.each([
    ['lightning://lnbc1...', 'lnbc1...'],
    ['lightning:lnbc1...', 'lnbc1...'],
    ['lightning=lnbc1...', 'lnbc1...'],
  ])('strips lightning prefix from %s', (input, expected) => {
    expect(stripLightningPrefixes(input)).toBe(expected);
  });

  it('does not strip cashu prefixes', () => {
    // If someone puts a cashu token through stripLightningPrefixes,
    // the cashu: prefix must survive — only Lightning prefixes are removed
    expect(stripLightningPrefixes('cashu:cashuA...')).toBe('cashu:cashuA...');
  });
});

// ---------------------------------------------------------------------------
// stripCashuPrefixes
// ---------------------------------------------------------------------------

/**
 * stripCashuPrefixes is the mirror of stripLightningPrefixes — only
 * removes cashu:// and cashu: prefixes, leaving everything else intact.
 */
describe('stripCashuPrefixes', () => {
  it.each([
    ['cashu://cashuA...', 'cashuA...'],
    ['cashu:cashuA...', 'cashuA...'],
  ])('strips cashu prefix from %s', (input, expected) => {
    expect(stripCashuPrefixes(input)).toBe(expected);
  });

  it('does not strip lightning prefixes', () => {
    expect(stripCashuPrefixes('lightning:lnbc1...')).toBe('lightning:lnbc1...');
  });
});

// ---------------------------------------------------------------------------
// inputVariants
// ---------------------------------------------------------------------------

/**
 * inputVariants generates all plausible interpretations of a raw input
 * string. The parser tries each variant against each detector, so a
 * single input can be detected even if it has prefixes, URI encoding,
 * or both.
 *
 * The variants generated are:
 *   1. sanitized     — raw input with whitespace/invisible chars removed
 *   2. stripped      — all payment prefixes removed
 *   3. decoded       — URI-decoded version of sanitized
 *   4. decodedStripped — URI-decoded version of stripped
 *
 * The result is a Set, so identical variants are automatically deduped.
 * For a plain string like "hello" all 4 variants are identical, so the
 * set contains just 1 entry.
 */
describe('inputVariants', () => {
  it('returns a set with at least the sanitized value', () => {
    const variants = inputVariants('hello');
    expect(variants).toBeInstanceOf(Set);
    expect(variants.has('hello')).toBe(true);
  });

  it('includes stripped and decoded variants', () => {
    // Input has a cashu: prefix — the set should contain both the
    // prefixed form and the stripped form so both the cashu detector
    // and a hypothetical prefix-aware detector can match
    const variants = inputVariants('cashu:cashuA...');
    expect(variants.has('cashu:cashuA...')).toBe(true);  // sanitized (unchanged)
    expect(variants.has('cashuA...')).toBe(true);          // stripped
  });

  it('deduplicates identical variants', () => {
    // "hello" has no prefix and no encoding, so all 4 variants
    // (sanitized, stripped, decoded, decodedStripped) are identical.
    // The Set should contain exactly 1 unique entry.
    const variants = inputVariants('hello');
    expect(variants.size).toBe(1);
  });

  it('includes URI-decoded variant', () => {
    // %3A = ":" — this input is the URI-encoded form of "cashu:cashuA..."
    // After decoding, the colon appears, and then stripping removes
    // the cashu: prefix, giving us the raw token.
    const variants = inputVariants('cashu%3AcashuA...');
    expect(variants.has('cashu:cashuA...')).toBe(true);
  });
});
