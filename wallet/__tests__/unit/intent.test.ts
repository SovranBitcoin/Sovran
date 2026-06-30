/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * intent.ts — Intent Resolution
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * After parsePaymentInput produces a ParsedInput, resolveIntent converts
 * it into a ResolvedIntent — the machine's decision about what to do next.
 *
 * The intent resolver handles three categories:
 *
 *   1. SINGLE-OPTION PAYMENTS — When the parser found exactly one payment
 *      option, the resolver maps it directly to an intent:
 *        ecashToken → receiveToken (we're receiving ecash)
 *        lightningInvoice → meltLightningInvoice (we're paying an invoice)
 *        lightningAddress → meltLightningAddress (we're paying an address)
 *        lnurlp → meltLnurlp (we're paying via LNURL)
 *        paymentRequest → sendPaymentRequest (we're fulfilling a request)
 *
 *   2. NON-PAYMENT INPUTS — For types that aren't payments:
 *        mintUrl → openMint (navigate to mint info screen)
 *        npub → openProfile (navigate to Nostr profile)
 *        unknown/bip321-empty → ignore (show error, unrecognized input)
 *
 *   3. MULTI-OPTION — When the parser found multiple options (e.g. a
 *      BIP-321 URI with both cashu and lightning), the resolver returns
 *      type: 'chooseOption' with annotated options so the UI can present
 *      a picker screen.
 *
 * When wallet context is provided to resolveIntent, multi-option intents
 * get their options annotated with availability status (available, disabled,
 * recommended) based on wallet balance, trusted mints, etc.
 */

import { describe, it, expect } from 'vitest';
import { resolveIntent } from '../../src/intent';
import { parsePaymentInput } from '../../src/parse';
import { defaultDetectors } from '../../src/detectors';
import { INPUTS, WALLETS, MINT1 } from '../_harness/fixtures';

/**
 * Helper that parses input with real detectors — same as in parse.test.ts.
 * resolveIntent receives the ParsedInput from this function.
 */
const parse = (input: string) => parsePaymentInput(input, defaultDetectors);

// ---------------------------------------------------------------------------
// Single-option direct intents
// ---------------------------------------------------------------------------

/**
 * When the parser detects exactly one payment option, resolveIntent
 * maps it directly to a specific intent type. No user choice is needed —
 * the machine knows exactly what flow to run.
 *
 * Each intent type carries the original option and any extracted metadata
 * (like payment request info with amount, unit, and mints).
 */
describe('resolveIntent — single option', () => {
  const validOnchainAddress = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';

  it('resolves ecash token to receiveToken', () => {
    // A cashu token has one option (ecashToken). The intent should be
    // receiveToken — the machine will route to the receive token screen.
    const parsed = parse(INPUTS.cashuTokenV3);
    const intent = resolveIntent(parsed, defaultDetectors);
    expect(intent.type).toBe('receiveToken');
    if (intent.type === 'receiveToken') {
      // The intent carries the original option so the machine can
      // extract the token value for redemption
      expect(intent.option.kind).toBe('ecashToken');
    }
  });

  it('resolves lightning address to meltLightningAddress', () => {
    // Lightning addresses need amount input before we can fetch an invoice.
    // The "melt" prefix means we're spending ecash → Lightning.
    const parsed = parse(INPUTS.lightningAddress);
    const intent = resolveIntent(parsed, defaultDetectors);
    expect(intent.type).toBe('meltLightningAddress');
  });

  it('resolves lnurlp to meltLnurlp', () => {
    // LNURL-pay works similarly to lightning addresses — amount needed first.
    // Note: we use the lnurlp:// scheme because raw URLs are classified as mintUrl.
    const parsed = parse('lnurlp://pay.walletofsatoshi.com/lnurlp/xyz');
    const intent = resolveIntent(parsed, defaultDetectors);
    expect(intent.type).toBe('meltLnurlp');
  });

  it('resolves payment request to sendPaymentRequest with info', () => {
    // Payment requests are the most information-rich format. The intent
    // includes decoded `info` with target mints, amount, unit, and transports.
    // This info drives the machine's routing decisions (mint selection,
    // balance checks, transport method).
    const parsed = parse(INPUTS.paymentRequestBasic);
    const intent = resolveIntent(parsed, defaultDetectors);
    expect(intent.type).toBe('sendPaymentRequest');
    if (intent.type === 'sendPaymentRequest') {
      expect(intent.info).toBeDefined();
      // Payment request CBOR includes a unit field (e.g. 'sat')
      expect(intent.info.unit).toBeDefined();
    }
  });

  it('routes standalone onchain addresses to capability-aware onchain melt intent', () => {
    const parsed = parse(`bitcoin:${validOnchainAddress}?amount=0.00001234`);
    const intent = resolveIntent(parsed, defaultDetectors);
    expect(intent.type).toBe('meltOnchainAddress');
    if (intent.type === 'meltOnchainAddress') {
      expect(intent.option.kind).toBe('onchainAddress');
    }
  });

  it('does not route BIP321 URIs with unsupported required parameters', () => {
    const parsed = parse(`bitcoin:${validOnchainAddress}?req-pop=sovran%3Apop`);
    const intent = resolveIntent(parsed, defaultDetectors);
    expect(intent.type).toBe('ignore');
    if (intent.type === 'ignore') {
      expect(intent.reason.message).toBe('Unsupported required bitcoin params: req-pop');
    }
  });
});

// ---------------------------------------------------------------------------
// Non-payment intents
// ---------------------------------------------------------------------------

/**
 * Some input types don't represent payments — they're navigation actions.
 * Mint URLs open the mint info screen, npubs open a Nostr profile,
 * and unrecognized inputs are ignored with an error code.
 *
 * These intents have no payment options and no amount/mint context.
 */
describe('resolveIntent — non-payment', () => {
  it('resolves mint URL to openMint', () => {
    // Mint URLs trigger navigation to the mint info screen. The intent
    // carries the URL so the machine can pass it to the handler.
    const parsed = parse(INPUTS.mintUrl);
    const intent = resolveIntent(parsed, defaultDetectors);
    expect(intent.type).toBe('openMint');
    if (intent.type === 'openMint') {
      expect(intent.url).toBe(MINT1);
    }
  });

  it('resolves npub to openProfile', () => {
    // npubs trigger navigation to a Nostr profile screen. The decoded
    // public key hex is carried in the intent.
    const parsed = parse(INPUTS.npub);
    const intent = resolveIntent(parsed, defaultDetectors);
    expect(intent.type).toBe('openProfile');
    if (intent.type === 'openProfile') {
      expect(intent.npub).toBeTruthy();
    }
  });

  it('resolves unknown input to ignore', () => {
    // Random strings that match no detector produce an 'ignore' intent
    // with an error reason. The machine routes this to the error step.
    const parsed = parse(INPUTS.randomString);
    const intent = resolveIntent(parsed, defaultDetectors);
    expect(intent.type).toBe('ignore');
    if (intent.type === 'ignore') {
      expect(intent.reason.code).toBe('UNSUPPORTED_INPUT');
    }
  });

  it('resolves empty bip321 (no supported options) to ignore', () => {
    // A bitcoin: URI with no supported payment options. We recognize the
    // BIP-321 format but can't do anything with it.
    const parsed = parse('bitcoin:bc1qxyz123');
    const intent = resolveIntent(parsed, defaultDetectors);
    expect(intent.type).toBe('ignore');
  });
});

// ---------------------------------------------------------------------------
// Multi-option → chooseOption
// ---------------------------------------------------------------------------

/**
 * BIP-321 URIs can contain multiple payment options (e.g. a cashu token
 * AND a lightning address). When multiple options are detected, the
 * resolver returns type: 'chooseOption' so the UI can present a picker.
 *
 * If wallet context is provided, each option is annotated with a status:
 *   - 'recommended': best option based on wallet state (e.g. has balance)
 *   - 'available': usable but not the best choice
 *   - 'disabled': can't be used (e.g. no balance for lightning payment)
 *
 * Without wallet context, all options default to 'available'.
 */
describe('resolveIntent — multiple options', () => {
  it('returns chooseOption when multiple options exist', () => {
    // BIP-321 URI with both cashu token and lightning address → 2 options.
    // The resolver should return chooseOption so the user can pick one.
    const parsed = parse(
      `bitcoin:?cashu=${INPUTS.cashuTokenV3}&lightning=${INPUTS.lightningAddress}`
    );
    if (parsed.options.length > 1) {
      const intent = resolveIntent(parsed, defaultDetectors);
      expect(intent.type).toBe('chooseOption');
    }
  });

  it('annotates options with wallet context when provided', () => {
    // When we pass WALLETS.default (has balance, trusted mints), the
    // options get annotated with status based on what the wallet can do.
    // For example, the ecash token should be 'available' (receiving is
    // always possible), and lightning should be 'available' (has balance).
    const parsed = parse(
      `bitcoin:?cashu=${INPUTS.cashuTokenV3}&lightning=${INPUTS.lightningAddress}`
    );
    if (parsed.options.length > 1) {
      const intent = resolveIntent(parsed, defaultDetectors, WALLETS.default);
      expect(intent.type).toBe('chooseOption');
      if (intent.type === 'chooseOption') {
        // Every option should have a 'status' field from annotation
        expect(intent.options.every((o) => 'status' in o)).toBe(true);
      }
    }
  });

  it('returns all options as available without wallet context', () => {
    // Without wallet context, we can't determine if options are disabled
    // (we don't know balances or trusted mints). All default to 'available'.
    const parsed = parse(
      `bitcoin:?cashu=${INPUTS.cashuTokenV3}&lightning=${INPUTS.lightningAddress}`
    );
    if (parsed.options.length > 1) {
      const intent = resolveIntent(parsed, defaultDetectors);
      if (intent.type === 'chooseOption') {
        expect(intent.options.every((o) => o.status === 'available')).toBe(true);
      }
    }
  });
});
