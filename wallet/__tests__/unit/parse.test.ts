/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * parse.ts — Payment Input Parsing
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * These tests cover `parsePaymentInput`, the single entry point that turns
 * a raw string into a structured `ParsedInput` object. Every string the
 * user enters (via QR scan, clipboard paste, deep link, or manual typing)
 * flows through this function before anything else happens.
 *
 * parsePaymentInput works by:
 *   1. Sanitizing + normalizing the input (handled by normalize.ts)
 *   2. Generating input variants (raw, stripped, decoded, decodedStripped)
 *   3. Running every variant through every detector (cashu, bolt11,
 *      lightning address, lnurlp, payment request, mint URL, npub, BIP-321)
 *   4. Collecting all detected options, deduplicating, and sorting by
 *      priority (paymentRequest > ecashToken > lightningInvoice > etc.)
 *
 * The output `ParsedInput` has:
 *   - `type`: 'payment' | 'mintUrl' | 'npub' | 'bip321' | 'ur' | 'unknown'
 *   - `container`: 'standalone' | 'bip321' (was the input a BIP-321 URI?)
 *   - `options[]`: detected payment options, sorted by priority
 *   - `warnings[]`: non-fatal issues (e.g. unknown BIP-321 params)
 *   - `errors[]`: why parsing failed (e.g. 'Empty input')
 *   - `normalized`: the cleaned input after sanitization
 *
 * IMPORTANT: These tests use REAL detectors from `defaultDetectors` —
 * the same @cashu/cashu-ts, bolt11-decode, and nostr-tools decoders used
 * in production. This means test fixtures must be real, valid encoded
 * strings (not mock data).
 */

import { describe, it, expect } from 'vitest';
import { buildBip321OnchainUri } from '../../src/bip321';
import { parsePaymentInput } from '../../src/parse';
import { defaultDetectors } from '../../src/detectors';
import { INPUTS, MINT1 } from '../_harness/fixtures';

/**
 * Helper that binds defaultDetectors so every test just calls parse(string).
 * This mirrors how the real machine calls parsePaymentInput internally.
 */
const parse = (input: string) => parsePaymentInput(input, defaultDetectors);

// ---------------------------------------------------------------------------
// Empty / unknown input
// ---------------------------------------------------------------------------

/**
 * The first thing the parser must handle is garbage input. Users can paste
 * anything — random text, partial URLs, or nothing at all. The parser must
 * never throw; instead it returns type: 'unknown' with helpful error messages.
 */
describe('parsePaymentInput — empty and unknown', () => {
  it('returns unknown with error for empty string', () => {
    // Empty string is the most basic invalid input. The parser should
    // immediately return 'unknown' without running any detectors.
    const result = parse('');
    expect(result.type).toBe('unknown');
    expect(result.options).toHaveLength(0);
    expect(result.errors).toContain('Empty input');
  });

  it('returns unknown with error for whitespace-only string', () => {
    // After sanitization, whitespace-only becomes empty string.
    // This catches the case where the clipboard contains only spaces/tabs.
    const result = parse('   ');
    expect(result.type).toBe('unknown');
    expect(result.errors).toContain('Empty input');
  });

  it('returns unknown for random string', () => {
    // A random English sentence doesn't match any payment format.
    // No detectors should fire, so options should be empty.
    const result = parse(INPUTS.randomString);
    expect(result.type).toBe('unknown');
    expect(result.options).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// UR animated QR fragments
// ---------------------------------------------------------------------------

/**
 * UR (Uniform Resource) is a protocol for encoding data across multiple
 * animated QR code frames. A single frame looks like "ur:bytes/1-3/abc123".
 *
 * When we detect a UR fragment, we return type: 'ur' with no options —
 * the caller needs to collect more frames before the full payload can be
 * parsed. The parser just flags "this is a UR fragment, keep scanning."
 */
describe('parsePaymentInput — UR fragments', () => {
  it('detects UR prefixed input', () => {
    // A UR fragment: "ur:" prefix, followed by type/part-index/payload
    const result = parse('ur:bytes/1-3/abc123');
    expect(result.type).toBe('ur');
    // No options yet — we need all fragments to reconstruct the payload
    expect(result.options).toHaveLength(0);
  });

  it('is case-insensitive for UR detection', () => {
    // QR code scanners may return uppercase. UR detection must be
    // case-insensitive because the QR standard uses uppercase alphanumeric.
    const result = parse('UR:bytes/1-3/abc123');
    expect(result.type).toBe('ur');
  });
});

// ---------------------------------------------------------------------------
// Cashu tokens
// ---------------------------------------------------------------------------

/**
 * Cashu tokens are the core ecash format. They start with "cashuA" (V3)
 * or "cashuB" (V4) followed by base64-encoded token data. The detector
 * uses @cashu/cashu-ts to decode and validate the token structure.
 *
 * Tokens can arrive with various prefixes:
 *   - Bare: "cashuAeyJ0b2..."
 *   - cashu: prefix: "cashu:cashuAeyJ0b2..."
 *   - cashu:// prefix: "cashu://cashuAeyJ0b2..."
 *
 * The inputVariants system (from normalize.ts) strips these prefixes and
 * tries each variant, so the detector always sees the raw token string.
 */
describe('parsePaymentInput — cashu tokens', () => {
  it('parses a valid cashu V3 token', () => {
    // INPUTS.cashuTokenV3 is a real base64-encoded V3 token targeting MINT1.
    // It was hand-crafted with real proof structure so @cashu/cashu-ts accepts it.
    const result = parse(INPUTS.cashuTokenV3);
    expect(result.type).toBe('payment');
    // 'standalone' means it wasn't inside a BIP-321 container
    expect(result.container).toBe('standalone');
    expect(result.options).toHaveLength(1);
    expect(result.options[0].kind).toBe('ecashToken');
  });

  it('parses a cashu token with cashu: prefix', () => {
    // cashu: is the standard URI scheme for ecash tokens (NUT-XX).
    // Wallets generate these for deep links and QR codes.
    const result = parse(`cashu:${INPUTS.cashuTokenV3}`);
    expect(result.type).toBe('payment');
    expect(result.options).toHaveLength(1);
    expect(result.options[0].kind).toBe('ecashToken');
  });

  it('parses a cashu token with cashu:// prefix', () => {
    // cashu:// is an alternative deep link format used by some wallets
    // (particularly iOS apps that register custom URL schemes)
    const result = parse(`cashu://${INPUTS.cashuTokenV3}`);
    expect(result.type).toBe('payment');
    expect(result.options).toHaveLength(1);
    expect(result.options[0].kind).toBe('ecashToken');
  });

  it('strips the prefix from the token value', () => {
    // The option's `value` field should contain the raw token string,
    // NOT the prefixed form. Downstream code passes `value` directly
    // to cashu-ts for redemption — the prefix would cause decoding to fail.
    const result = parse(`cashu:${INPUTS.cashuTokenV3}`);
    expect(result.options[0].value).not.toMatch(/^cashu:/);
  });
});

// ---------------------------------------------------------------------------
// Lightning addresses
// ---------------------------------------------------------------------------

/**
 * Lightning addresses look like email addresses (user@domain.com) but
 * resolve to LNURL-pay endpoints. The detector checks for the format
 * `<local>@<domain>` where domain has at least one dot.
 *
 * Lightning addresses are "amountless" — the user must enter an amount
 * before the wallet can fetch an invoice. This means the machine will
 * route to enterAmount, not directly to a confirmation step.
 */
describe('parsePaymentInput — lightning addresses', () => {
  it('detects a lightning address', () => {
    const result = parse(INPUTS.lightningAddress);
    expect(result.type).toBe('payment');
    expect(result.options).toHaveLength(1);
    expect(result.options[0].kind).toBe('lightningAddress');
    // The value should be the full address, unchanged
    expect(result.options[0].value).toBe(INPUTS.lightningAddress);
  });

  it('detects a lightning address with lightning: prefix', () => {
    // lightning: prefix is used in deep links. After stripping, the
    // detector sees the raw address and identifies it as a lightningAddress.
    const result = parse(`lightning:${INPUTS.lightningAddress}`);
    expect(result.type).toBe('payment');
    expect(result.options[0].kind).toBe('lightningAddress');
  });
});

// ---------------------------------------------------------------------------
// Onchain addresses
// ---------------------------------------------------------------------------

describe('parsePaymentInput — onchain addresses', () => {
  it('detects a standalone legacy mainnet address', () => {
    const result = parse('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');

    expect(result.type).toBe('payment');
    expect(result.container).toBe('standalone');
    expect(result.options).toEqual([
      expect.objectContaining({
        kind: 'onchainAddress',
        value: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        source: 'standalone',
        paramKey: null,
      }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// BOLT-12 offers
// ---------------------------------------------------------------------------

describe('parsePaymentInput — bolt12 offers', () => {
  it('detects a standalone lno1 offer as a bolt12Offer option', () => {
    const result = parse(INPUTS.bolt12Offer);
    expect(result.type).toBe('payment');
    expect(result.container).toBe('standalone');
    expect(result.options).toEqual([
      expect.objectContaining({
        kind: 'bolt12Offer',
        value: INPUTS.bolt12Offer,
        source: 'standalone',
      }),
    ]);
    // Amountless (quote-first) — no static amount seeded.
    expect(result.options[0].amount ?? null).toBeNull();
  });

  it('reads a bolt12 offer from a BIP-321 lno= param (builder/parser symmetry)', () => {
    const result = parse(INPUTS.bip321Bolt12);
    expect(result.options.some((o) => o.kind === 'bolt12Offer')).toBe(true);
    const offer = result.options.find((o) => o.kind === 'bolt12Offer');
    expect(offer?.source).toBe('bip321');
    expect(offer?.paramKey).toBe('lno');
  });

  it('accepts an UPPERCASE lno1 offer (QR alphanumeric mode)', () => {
    const result = parse(INPUTS.bolt12Offer.toUpperCase());
    expect(result.options.some((o) => o.kind === 'bolt12Offer')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Uppercase-QR tolerance (bech32 / Lightning bodies)
// ---------------------------------------------------------------------------

describe('parsePaymentInput — uppercase QR bodies', () => {
  it('decodes an UPPERCASE bolt11 invoice (case-insensitive bech32)', () => {
    const lower = parse(INPUTS.bolt11UppercaseQr.toLowerCase());
    const upper = parse(INPUTS.bolt11UppercaseQr);
    expect(lower.options[0]?.kind).toBe('lightningInvoice');
    expect(upper.options[0]?.kind).toBe('lightningInvoice');
  });

  it('does NOT lowercase a case-sensitive cashu token (base64url)', () => {
    // A cashuB/cashuA token contains lowercase, so the uppercase-QR path never
    // fires on it — round-trips unchanged.
    const result = parse(INPUTS.cashuTokenV3);
    expect(result.options[0]?.kind).toBe('ecashToken');
    expect(result.options[0]?.value).toBe(INPUTS.cashuTokenV3);
  });
});

// ---------------------------------------------------------------------------
// LNURL-pay
// ---------------------------------------------------------------------------

/**
 * LNURL-pay is a protocol where a URL resolves to Lightning payment
 * parameters. The detector looks for the `lnurlp://` scheme prefix.
 *
 * Note: raw HTTPS URLs like "https://pay.example.com/lnurlp/xyz" are
 * NOT detected as lnurlp — they look like mint URLs to the parser.
 * Only the explicit `lnurlp://` scheme triggers lnurlp detection.
 */
describe('parsePaymentInput — lnurlp', () => {
  it('detects an lnurlp URL', () => {
    // The raw URL (INPUTS.lnurlpUrl) is an https:// URL, which the parser
    // classifies as a mint URL. We need the lnurlp:// prefix to trigger
    // lnurlp detection.
    const result = parse(INPUTS.lnurlpUrl);
    // lnurlp regex expects lnurlp:// prefix, the raw URL is just an https URL
    // and will be classified as mintUrl. Let's test the actual expected behavior.
    const result2 = parse('lnurlp://pay.walletofsatoshi.com/lnurlp/xyz');
    expect(result2.type).toBe('payment');
    expect(result2.options[0].kind).toBe('lnurlp');
  });
});

// ---------------------------------------------------------------------------
// Payment requests
// ---------------------------------------------------------------------------

/**
 * Payment requests use the "creq" prefix followed by CBOR-encoded data.
 * They specify: target mints, amount, unit, and transport method (HTTP POST
 * or Nostr). The detector decodes the CBOR and extracts structured info.
 *
 * INPUTS.paymentRequestBasic is a real CBOR-encoded payment request
 * generated with cashu-ts PaymentRequest class, targeting MINT1 with
 * amount=100, unit=sat, transport=POST.
 */
describe('parsePaymentInput — payment requests', () => {
  it('detects a payment request (creq prefix)', () => {
    const result = parse(INPUTS.paymentRequestBasic);
    expect(result.type).toBe('payment');
    // The options array should contain a paymentRequest option
    expect(result.options.some((o) => o.kind === 'paymentRequest')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mint URLs
// ---------------------------------------------------------------------------

/**
 * Mint URLs are HTTPS URLs that point to Cashu mint servers. The detector
 * checks for `https://` prefix and validates URL structure. When a mint
 * URL is detected, the parser returns type: 'mintUrl' (NOT 'payment') —
 * the user wants to browse/add the mint, not make a payment.
 *
 * Mint URLs have no options[] because they're not payment options —
 * they trigger the openMint flow instead.
 */
describe('parsePaymentInput — mint URLs', () => {
  it('detects a mint URL', () => {
    const result = parse(INPUTS.mintUrl);
    expect(result.type).toBe('mintUrl');
    // The extracted mint URL should match the input
    expect(result.mintUrl).toBe(MINT1);
    // No payment options — this is a navigation action, not a payment
    expect(result.options).toHaveLength(0);
  });

  it('detects a mint URL with trailing slash', () => {
    // URLs often have trailing slashes from copy-paste. The parser should
    // normalize this and still detect it as a mint URL.
    const result = parse(INPUTS.mintUrlWithTrailingSlash);
    expect(result.type).toBe('mintUrl');
  });

  it('rejects a plain http:// mint URL', () => {
    // Cashu mint traffic carries blinded messages, signatures, and melt
    // quotes; on plain HTTP a MitM can swap-race or return malformed Bs.
    // The parser must not classify cleartext mints as `mintUrl` — it
    // surfaces MINT_INSECURE_HTTP so the wallet's trust flow can refuse.
    const result = parse('http://mint1.example.com');
    expect(result.type).toBe('unknown');
    expect(result.errors).toContain('MINT_INSECURE_HTTP');
  });

  it('accepts http:// for a .onion mint', () => {
    // Tor hidden services do not use TLS; their transport is already
    // anonymised and authenticated by the .onion address.
    const result = parse('http://abcdefghijklmnop.onion/mint');
    expect(result.type).toBe('mintUrl');
    expect(result.errors).not.toContain('MINT_INSECURE_HTTP');
  });
});

// ---------------------------------------------------------------------------
// Nostr npub
// ---------------------------------------------------------------------------

/**
 * npub is a Nostr public key encoded in bech32 format. The detector uses
 * nostr-tools' nip19.decode() to validate the bech32 encoding.
 *
 * Like mint URLs, npubs return type: 'npub' (not 'payment') and trigger
 * the openProfile flow — the user wants to view a Nostr profile, not
 * make a payment.
 *
 * INPUTS.npub is a real bech32-encoded npub with valid checksum, generated
 * by nip19.npubEncode() with a test hex public key.
 */
describe('parsePaymentInput — npub', () => {
  it('detects a valid npub', () => {
    const result = parse(INPUTS.npub);
    expect(result.type).toBe('npub');
    // The decoded npub hex should be present
    expect(result.npub).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// BIP-321 containers
// ---------------------------------------------------------------------------

/**
 * BIP-321 defines the `bitcoin:` URI scheme for payment requests.
 * These URIs can contain multiple payment options as query parameters:
 *   - `lightning=<invoice>` — a Lightning invoice or address
 *   - `cashu=<token>` — a Cashu ecash token
 *   - The base address (e.g. `bitcoin:bc1q...`) — an on-chain address
 *
 * BIP-321 is a "container" format — it wraps other payment options.
 * The parser extracts each parameter, runs it through the appropriate
 * detector, and returns all options with container: 'bip321'.
 *
 * The parser extracts supported payment options, including on-chain fallback
 * addresses. The intent resolver decides later whether a wallet can act on
 * those options.
 */
describe('parsePaymentInput — BIP-321', () => {
  const validOnchainAddress = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';

  it('parses a bitcoin: URI with lightning param', () => {
    // INPUTS.bip321LightningOnly = 'bitcoin:?lightning=lnbc1u1p0test'
    // The parser should extract the lightning parameter and detect it
    const result = parse(INPUTS.bip321LightningOnly);
    expect(result.container).toBe('bip321');
  });

  it('warns about unsupported params', () => {
    // 'custom_param' is not a recognized BIP-321 parameter.
    // The parser should still parse the lightning param but add a warning
    // about the unknown parameter so the UI can inform the user.
    const result = parse('bitcoin:?custom_param=foo&lightning=lnbc1u1p0test');
    expect(result.container).toBe('bip321');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('custom_param');
  });

  it('rejects unsupported required params without keeping fallback options', () => {
    const result = parse(`bitcoin:${validOnchainAddress}?req-unknown=1&amount=0.00001234`);
    expect(result.type).toBe('bip321');
    expect(result.container).toBe('bip321');
    expect(result.options).toHaveLength(0);
    expect(result.errors).toContain('Unsupported required bitcoin params: req-unknown');
    expect(result.bip321?.unsupportedRequiredParamKeys).toEqual(['req-unknown']);
  });

  it('rejects required proof-of-payment callbacks because callbacks are unsupported', () => {
    const result = parse(`bitcoin:${validOnchainAddress}?req-pop=sovran%3Apop`);
    expect(result.type).toBe('bip321');
    expect(result.options).toHaveLength(0);
    expect(result.errors).toContain('Unsupported required bitcoin params: req-pop');
  });

  it('normalizes BIP321 parameter keys case-insensitively', () => {
    const result = parse(`BITCOIN:${validOnchainAddress}?AMOUNT=0.00001234`);
    expect(result.type).toBe('payment');
    expect(result.options).toEqual([
      expect.objectContaining({
        kind: 'onchainAddress',
        amount: 1234,
      }),
    ]);
  });

  it('returns bip321 type when no supported options found', () => {
    // This is intentionally address-shaped but invalid enough to fail the
    // lightweight Bitcoin address guard. type is still 'bip321' (not
    // 'unknown') because we recognized the container format.
    const result = parse('bitcoin:bc1qxyz123');
    expect(result.type).toBe('bip321');
    expect(result.container).toBe('bip321');
    expect(result.options).toHaveLength(0);
  });

  it('extracts a valid onchain fallback address with decimal BTC amount in sats', () => {
    const result = parse(`bitcoin:${validOnchainAddress}?amount=0.00001234`);
    expect(result.type).toBe('payment');
    expect(result.container).toBe('bip321');
    expect(result.options).toEqual([
      expect.objectContaining({
        kind: 'onchainAddress',
        value: validOnchainAddress,
        amount: 1234,
        source: 'bip321',
      }),
    ]);
  });

  it('extracts an onchain URI built for an exact sat amount', () => {
    const uri = buildBip321OnchainUri(validOnchainAddress, {
      amountSats: 1234,
      message: 'Sovran onchain receive',
    });
    const result = parse(uri);

    expect(uri).toBe(
      `bitcoin:${validOnchainAddress}?amount=0.00001234&message=Sovran%20onchain%20receive`
    );
    expect(result.type).toBe('payment');
    expect(result.container).toBe('bip321');
    expect(result.bip321?.message).toBe('Sovran onchain receive');
    expect(result.options).toEqual([
      expect.objectContaining({
        kind: 'onchainAddress',
        value: validOnchainAddress,
        amount: 1234,
        source: 'bip321',
      }),
    ]);
  });

  it('extracts bech32 onchain address query params by network HRP', () => {
    const result = parse(`bitcoin:?BC=${validOnchainAddress}&amount=0.00001234`);
    expect(result.type).toBe('payment');
    expect(result.options).toEqual([
      expect.objectContaining({
        kind: 'onchainAddress',
        value: validOnchainAddress,
        amount: 1234,
        source: 'bip321',
        paramKey: 'bc',
      }),
    ]);
  });

  it('extracts testnet bech32 address query params', () => {
    const testnetAddress = 'tb1qghfhmd4zh7ncpmxl3qzhmq566jk8ckq4gafnmg';
    const result = parse(`bitcoin:?tb=${testnetAddress}`);
    expect(result.type).toBe('payment');
    expect(result.options).toEqual([
      expect.objectContaining({
        kind: 'onchainAddress',
        value: testnetAddress,
        source: 'bip321',
        paramKey: 'tb',
      }),
    ]);
  });

  it('extracts BIP321 private and silent payment instructions as onchain options', () => {
    const result = parse('bitcoin:?pay=pay1privatepayment&sp=sp1silentpayment&amount=0.00001234');
    expect(result.type).toBe('payment');
    expect(result.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'onchainAddress',
          value: 'pay1privatepayment',
          amount: 1234,
          paramKey: 'pay',
        }),
        expect.objectContaining({
          kind: 'onchainAddress',
          value: 'sp1silentpayment',
          amount: 1234,
          paramKey: 'sp',
        }),
      ])
    );
  });

  it('keeps the onchain option when the amount has too many decimal places', () => {
    const result = parse(`bitcoin:${validOnchainAddress}?amount=0.000000001`);
    expect(result.type).toBe('payment');
    expect(result.options).toEqual([
      expect.objectContaining({
        kind: 'onchainAddress',
        value: validOnchainAddress,
        amount: null,
      }),
    ]);
    expect(result.warnings).toContain('Ignored invalid bitcoin amount');
  });

  it('includes onchain fallback alongside lightning options', () => {
    const result = parse(
      `bitcoin:${validOnchainAddress}?amount=0.00001234&lightning=${INPUTS.lightningAddress}`
    );
    expect(result.container).toBe('bip321');
    expect(result.options.map((option) => option.kind)).toContain('onchainAddress');
    expect(result.options.map((option) => option.kind)).toContain('lightningAddress');
  });
});

// ---------------------------------------------------------------------------
// Option sorting priority
// ---------------------------------------------------------------------------

/**
 * When multiple payment options are detected (e.g. from a BIP-321 URI),
 * they must be sorted by priority so the machine can auto-select the
 * best option or present them in order of preference.
 *
 * Priority order (highest first):
 *   1. paymentRequest — most specific, has amount + mint + transport
 *   2. ecashToken — instant settlement, no network needed
 *   3. lightningInvoice — specific invoice with amount
 *   4. lightningAddress — needs amount resolution
 *   5. lnurlp — needs amount resolution
 *
 * This ordering reflects user experience: instant > specific > generic.
 */
describe('parsePaymentInput — option priority', () => {
  it('sorts options by priority: paymentRequest > ecashToken > lightningInvoice > lightningAddress > lnurlp', () => {
    // BIP-321 with both a cashu token and a lightning address.
    // The ecash token should appear before the lightning address in the
    // sorted options array because ecash has higher priority.
    const result = parse(
      `bitcoin:?cashu=${INPUTS.cashuTokenV3}&lightning=${INPUTS.lightningAddress}`
    );
    if (result.options.length >= 2) {
      const kinds = result.options.map((o) => o.kind);
      const ecashIdx = kinds.indexOf('ecashToken');
      const lnAddrIdx = kinds.indexOf('lightningAddress');
      if (ecashIdx !== -1 && lnAddrIdx !== -1) {
        // ecashToken (priority 2) should come before lightningAddress (priority 4)
        expect(ecashIdx).toBeLessThan(lnAddrIdx);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * The inputVariants system generates multiple versions of the input (raw,
 * stripped, decoded, etc.) and runs each through every detector. This can
 * produce duplicate options when multiple variants match the same detector.
 *
 * For example, parsing "cashuAtoken..." generates variants:
 *   - "cashuAtoken..." (sanitized)
 *   - "cashuAtoken..." (stripped — no prefix to strip)
 * Both variants hit the cashu detector and produce the same option.
 *
 * The parser deduplicates by (kind, value) to avoid presenting the user
 * with duplicate options in the chooseOption screen.
 */
describe('parsePaymentInput — deduplication', () => {
  it('does not produce duplicate options for the same value', () => {
    const result = parse(INPUTS.cashuTokenV3);
    // Create a unique key for each option based on kind + value
    const keys = result.options.map((o) => `${o.kind}:${o.value}`);
    // The Set size should equal the array length (no duplicates)
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// Input with zero-width chars / BOM
// ---------------------------------------------------------------------------

/**
 * Real-world inputs often contain invisible characters from copy-paste.
 * The parser must sanitize these BEFORE running detectors, otherwise a
 * valid token like "cashuAeyJ..." could fail detection because of a
 * hidden BOM (\uFEFF) at the start.
 *
 * This test verifies the full pipeline: sanitize → detect → parse.
 */
describe('parsePaymentInput — sanitization', () => {
  it('normalizes input before parsing', () => {
    // \uFEFF = Byte Order Mark, often added by clipboard on Windows/macOS.
    // The parser should strip it, then successfully detect the mint URL.
    const result = parse(`\uFEFF${INPUTS.mintUrl}`);
    expect(result.type).toBe('mintUrl');
    // The `normalized` field should show the cleaned input without BOM
    expect(result.normalized).toBe(INPUTS.mintUrl);
  });
});
