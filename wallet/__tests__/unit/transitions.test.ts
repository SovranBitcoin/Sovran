/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * transitions.ts — Pure Transition Function
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is the heart of the state machine. The `transition()` function is
 * a pure function: (step, context, event) → { step, context }. Given the
 * current state and an event, it returns the next state. No side effects,
 * no async, no I/O.
 *
 * IMPORTANT DISTINCTION: These tests call `transition()` directly — the
 * raw pure function. This is different from the flow tests that use
 * `createTestMachine()`, which wraps `transition()` with auto-execution.
 *
 * What this means in practice:
 *   - transition() returns INTERMEDIATE steps like 'confirmSend' and
 *     'createMintQuote' that the machine wrapper auto-resolves.
 *   - In flow tests, 'confirmSend' auto-resolves to 'sendComplete'.
 *   - Here, we test the pure transition and expect 'confirmSend'.
 *
 * Event types tested:
 *
 *   GLOBAL EVENTS (handled from any step):
 *     RESET            → idle (clears all context)
 *     EXECUTE          → varies (parse input → resolve intent → route)
 *     START_SEND_ECASH → enterAmount or selectMint or error
 *     START_RECEIVE_LIGHTNING → enterAmount (destination: mintQuote)
 *     START_RECEIVE    → receiveHub
 *     REQUEST_MINT_SELECTOR → selectMint
 *     REVIEW_MINT      → reviewMint
 *     MINT_TRUSTED     → receiveToken (when reviewToken exists)
 *
 *   STATE-SPECIFIC EVENTS (only handled in their respective step):
 *     AMOUNT_ENTERED   → advances past enterAmount
 *     MINT_SELECTED    → advances past selectMint
 *     PROOFS_CHOSEN    → routes to terminal step based on destination
 *     OPTION_CHOSEN    → re-resolves intent for the chosen option
 *
 *   UNHANDLED EVENTS:
 *     Events not recognized at the current step return the current state
 *     unchanged. The machine wrapper handles CONFIRM_MELT, etc. separately.
 */

import { describe, it, expect } from 'vitest';
import { transition, type TransitionResult } from '../../src/machine/transitions';
import { defaultDetectors } from '../../src/detectors';
import { parsePaymentInput } from '../../src/parse';
import { deriveMintMethodCapabilityMapFromTrustedMints } from '../../src/mint-capabilities';
import { WALLETS, MINT1, MINT2, MINT3, INPUTS } from '../_harness/fixtures';
import type { FlowContext, FlowEvent, FlowStep } from '../../src/machine/types';
import type { WalletContext } from '../../src/types';

const UNIT = 'sat';

/**
 * Helper to call transition() with defaults. Uses WALLETS.default
 * as the wallet context unless overridden. Keeps test code concise.
 */
function tx(
  step: FlowStep,
  ctx: FlowContext,
  event: FlowEvent,
  wallet: WalletContext = WALLETS.default,
  opts?: {
    unit?: string;
    getSatsPerUnitMinor?: (unit: string) => number | null;
  }
): TransitionResult {
  return transition(
    step,
    ctx,
    event,
    defaultDetectors,
    wallet,
    opts?.unit ?? UNIT,
    undefined,
    false,
    opts?.getSatsPerUnitMinor
  );
}

/** The minimal idle context — just the unit. */
const idle: FlowContext = { unit: UNIT };

// ---------------------------------------------------------------------------
// RESET — global event
// ---------------------------------------------------------------------------

/**
 * RESET is the machine's "escape hatch". From ANY step, at ANY time,
 * RESET returns to idle with a clean context. This is critical for:
 *   - User tapping "Cancel" or "Back" during a flow
 *   - The app clearing state when the payment sheet dismisses
 *   - Recovery from stuck states
 *
 * The ONLY context field preserved is `unit` — the currency unit is
 * a session-level setting, not a flow-level one.
 */
describe('transition — RESET', () => {
  it('returns to idle from any step', () => {
    // Start in enterAmount with accumulated context (amount, mintUrl).
    // RESET should wipe everything and return to idle.
    const result = tx('enterAmount', { ...idle, amount: 100, mintUrl: MINT1 }, { type: 'RESET' });
    expect(result.step).toBe('idle');
    // Amount from the previous flow should be gone
    expect(result.context.amount).toBeUndefined();
  });

  it('clears the context', () => {
    // Even complex context fields like `parsed` (the parsed input) should
    // be wiped. Only `unit` survives a RESET.
    const result = tx('error', { ...idle, parsed: {} as any }, { type: 'RESET' });
    expect(result.context.parsed).toBeUndefined();
    expect(result.context.unit).toBe(UNIT);
  });
});

// ---------------------------------------------------------------------------
// EXECUTE — global event
// ---------------------------------------------------------------------------

/**
 * EXECUTE is the primary entry point. It takes a raw input string,
 * parses it (using real detectors), resolves the intent, and routes
 * to the appropriate step. This single event handles every possible
 * input format.
 *
 * The routing logic:
 *   cashuToken       → receiveToken (instant, no further input needed)
 *   lightningAddress → enterAmount (needs amount before we can pay)
 *   mintUrl          → openMint (navigation, not a payment)
 *   npub             → openProfile (navigation, not a payment)
 *   unknown          → error (unrecognized input)
 *   paymentRequest   → varies (check mint trust, balance, then route)
 */
describe('transition — EXECUTE', () => {
  const validOnchainAddress = '1BM1sAcrfV6d4zPKytzziu4McLQDsFC2Qc';

  it('routes cashu token to receiveToken', () => {
    // Cashu tokens are the simplest flow: parse → receiveToken.
    // No amount entry, no mint selection — the token IS the payment.
    const result = tx('idle', idle, { type: 'EXECUTE', input: INPUTS.cashuTokenV3 });
    expect(result.step).toBe('receiveToken');
  });

  it('routes lightning address to enterAmount (needs amount)', () => {
    // Lightning addresses don't include an amount — the user must enter one.
    // The machine routes to enterAmount and stores the address as meltTarget.
    const result = tx('idle', idle, { type: 'EXECUTE', input: INPUTS.lightningAddress });
    expect(result.step).toBe('enterAmount');
    // meltTarget stores the address for later (when we fetch the invoice)
    expect(result.context.meltTarget).toBe(INPUTS.lightningAddress);
  });

  it('routes mint URL to openMint', () => {
    // Mint URLs aren't payments — they navigate to the mint info screen.
    const result = tx('idle', idle, { type: 'EXECUTE', input: INPUTS.mintUrl });
    expect(result.step).toBe('openMint');
  });

  it('routes npub to openProfile', () => {
    // npubs navigate to the Nostr profile screen.
    const result = tx('idle', idle, { type: 'EXECUTE', input: INPUTS.npub });
    expect(result.step).toBe('openProfile');
  });

  it('routes unknown input to error', () => {
    // Random strings that match no detector → error step
    const result = tx('idle', idle, { type: 'EXECUTE', input: INPUTS.randomString });
    expect(result.step).toBe('error');
  });

  it('routes payment request and extracts context', () => {
    // Payment requests extract rich context: the decoded PR object,
    // supported mint URLs, amount, etc. This context drives subsequent
    // steps (mint selection, balance check).
    const result = tx('idle', idle, { type: 'EXECUTE', input: INPUTS.paymentRequestBasic });
    // The paymentRequest field should be populated from CBOR decoding
    expect(result.context.paymentRequest).toBeTruthy();
  });

  it('reports a mint-capability error for standalone onchain addresses without onchain melt support', () => {
    const result = tx('idle', idle, {
      type: 'EXECUTE',
      input: validOnchainAddress,
    });

    expect(result.step).toBe('error');
    expect(result.data).toMatchObject({
      code: 'NO_VALID_MINT',
      message: 'No trusted mint supports onchain sending',
    });
  });

  it('opens amount entry when a mint advertises onchain melt (coco v2)', () => {
    const wallet: WalletContext = {
      ...WALLETS.default,
      mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
        {
          mintUrl: MINT1,
          mintInfo: {
            nuts: {
              '5': {
                methods: [{ method: 'onchain', unit: 'sat' }],
              },
            },
          },
        },
      ]),
    };

    const result = tx(
      'idle',
      idle,
      {
        type: 'EXECUTE',
        input: validOnchainAddress,
      },
      wallet
    );

    expect(result.step).toBe('enterAmount');
    expect(result.context.destination).toBe('meltQuote');
  });

  it('sets unit from the parsed context', () => {
    // The unit field is preserved across transitions — it comes from
    // the machine configuration, not the input.
    const result = tx('idle', idle, { type: 'EXECUTE', input: INPUTS.cashuTokenV3 });
    expect(result.context.unit).toBe(UNIT);
  });

  it('works from any step (not just idle)', () => {
    // EXECUTE is a global event — it works from enterAmount, error,
    // selectMint, or any other step. This enables "re-scan" during a flow.
    // The previous context (amount: 50) should be replaced.
    const result = tx(
      'enterAmount',
      { ...idle, amount: 50 },
      {
        type: 'EXECUTE',
        input: INPUTS.cashuTokenV3,
      }
    );
    expect(result.step).toBe('receiveToken');
  });
});

// ---------------------------------------------------------------------------
// EXECUTE — scanned fixed amounts on fiat-unit accounts (BTC-02)
// ---------------------------------------------------------------------------

/**
 * Scanned fixed amounts (BIP-321 `amount=`, fixed bolt11/bolt12) are ALWAYS
 * sat-denominated, but `ctx.amount` must be denominated in `ctx.unit`. On a
 * fiat-unit account the sats are re-denominated to the active unit ONCE at
 * seeding; booking raw sats into a fiat context double-converts at execution
 * (a 1000-sat BIP-321 target would melt ~rate× the requested amount).
 */
describe('transition — EXECUTE scanned fixed amounts on fiat units', () => {
  // 10 sats per usd-cent (≈ $100k/BTC).
  const tenSatsPerCent = () => 10;

  const usdOnchainWallet: WalletContext = {
    trustedMintUrls: [MINT1],
    mintBalances: { [MINT1]: 5000 }, // 5000¢
    preferredMintUrl: MINT1,
    proofAmounts: {},
    mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints(
      [
        {
          mintUrl: MINT1,
          mintInfo: {
            nuts: { '5': { methods: [{ method: 'onchain', unit: 'usd' }] } },
          },
        },
      ],
      'usd'
    ),
  };

  it('re-denominates a BIP-321 amount into the active fiat unit once', () => {
    // amount=0.0001 BTC = 10,000 sats → 1000¢ at 10 sats/¢.
    const result = tx(
      'idle',
      { unit: 'usd' },
      { type: 'EXECUTE', input: INPUTS.bip321OnchainWithAmount },
      usdOnchainWallet,
      { unit: 'usd', getSatsPerUnitMinor: tenSatsPerCent }
    );

    expect(result.step).toBe('navigateToMeltPreview');
    expect(result.context.unit).toBe('usd');
    expect(result.context.amount).toBe(1000);
    expect(result.data).toMatchObject({ amount: 1000, unit: 'usd' });
  });

  it('keeps sat seeding untouched on a sat-unit account', () => {
    const satOnchainWallet: WalletContext = {
      ...WALLETS.default,
      mintBalances: { [MINT1]: 100_000, [MINT2]: 500 },
      mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
        {
          mintUrl: MINT1,
          mintInfo: {
            nuts: { '5': { methods: [{ method: 'onchain', unit: 'sat' }] } },
          },
        },
      ]),
    };

    const result = tx(
      'idle',
      idle,
      { type: 'EXECUTE', input: INPUTS.bip321OnchainWithAmount },
      satOnchainWallet,
      { getSatsPerUnitMinor: tenSatsPerCent }
    );

    expect(result.step).toBe('navigateToMeltPreview');
    expect(result.context.amount).toBe(10_000);
    expect(result.context.unit).toBe('sat');
  });

  it('bounces to amount entry when no fiat rate is available', () => {
    // No rate getter → the amount must NOT be seeded as raw sats into the
    // fiat context. The flow asks the user to type the amount instead.
    const result = tx(
      'idle',
      { unit: 'usd' },
      { type: 'EXECUTE', input: INPUTS.bip321OnchainWithAmount },
      usdOnchainWallet,
      { unit: 'usd' }
    );

    expect(result.step).toBe('enterAmount');
    expect(result.context.amount).toBeUndefined();
  });

  it('bounces to amount entry when the amount is below one minor unit', () => {
    // 4 sats at 10 sats/¢ rounds to 0¢ — unrepresentable, so bounce.
    const result = tx(
      'idle',
      { unit: 'usd' },
      {
        type: 'EXECUTE',
        input:
          'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080?amount=0.00000004',
      },
      usdOnchainWallet,
      { unit: 'usd', getSatsPerUnitMinor: tenSatsPerCent }
    );

    expect(result.step).toBe('enterAmount');
    expect(result.context.amount).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// EXECUTE — fixed bolt11 invoices on fiat-unit accounts (BTC-03)
// ---------------------------------------------------------------------------

/**
 * A scanned fixed bolt11 is sat-denominated like any other scanned target.
 * On a fiat-unit account, seeding the sats raw made the preview render them
 * as fiat minor units (1,000 sats → "$10.00") and compared them against
 * fiat-denominated balances/capability bounds. Seeding converts once, so the
 * confirm screen shows the invoice's fiat equivalent and every gate compares
 * like units. (The invoice itself pins the wire amount — this was a
 * display/gating bug, not a wrong-amount send.)
 */
describe('transition — EXECUTE fixed bolt11 on fiat units', () => {
  // 10 sats per usd-cent (≈ $100k/BTC).
  const tenSatsPerCent = () => 10;

  const usdBolt11Wallet: WalletContext = {
    trustedMintUrls: [MINT1],
    mintBalances: { [MINT1]: 100_000 }, // 100,000¢
    preferredMintUrl: MINT1,
    proofAmounts: {},
    mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints(
      [
        {
          mintUrl: MINT1,
          mintInfo: {
            nuts: { '5': { methods: [{ method: 'bolt11', unit: 'usd' }] } },
          },
        },
      ],
      'usd'
    ),
  };

  it('re-denominates the invoice amount into the active fiat unit once', () => {
    // bolt11WithAmount = 250,000 sats → 25,000¢ at 10 sats/¢.
    const result = tx(
      'idle',
      { unit: 'usd' },
      { type: 'EXECUTE', input: INPUTS.bolt11WithAmount },
      usdBolt11Wallet,
      { unit: 'usd', getSatsPerUnitMinor: tenSatsPerCent }
    );

    expect(result.step).toBe('navigateToMeltPreview');
    expect(result.context.unit).toBe('usd');
    expect(result.context.amount).toBe(25_000);
    expect(result.data).toMatchObject({ amount: 25_000, unit: 'usd' });
  });

  it('balance gating compares like units (no false insufficient-balance)', () => {
    // 30,000¢ balance covers a 25,000¢ invoice but NOT 250,000 raw sats —
    // the pre-fix cross-unit gate would wrongly reject this invoice.
    const wallet: WalletContext = {
      ...usdBolt11Wallet,
      mintBalances: { [MINT1]: 30_000 },
    };
    const result = tx(
      'idle',
      { unit: 'usd' },
      { type: 'EXECUTE', input: INPUTS.bolt11WithAmount },
      wallet,
      { unit: 'usd', getSatsPerUnitMinor: tenSatsPerCent }
    );

    expect(result.step).toBe('navigateToMeltPreview');
  });

  it('bounces to amount entry when no fiat rate is available', () => {
    const result = tx(
      'idle',
      { unit: 'usd' },
      { type: 'EXECUTE', input: INPUTS.bolt11WithAmount },
      usdBolt11Wallet,
      { unit: 'usd' }
    );

    expect(result.step).toBe('enterAmount');
    expect(result.context.amount).toBeUndefined();
  });

  it('keeps sat seeding untouched on a sat-unit account', () => {
    const result = tx(
      'idle',
      idle,
      { type: 'EXECUTE', input: INPUTS.bolt11WithAmount },
      WALLETS.default,
      { getSatsPerUnitMinor: tenSatsPerCent }
    );

    expect(result.context.unit).toBe('sat');
    expect(result.context.amount).toBe(250_000);
  });
});

// ---------------------------------------------------------------------------
// EXECUTE / OPTION_CHOSEN — cross-unit NUT-18 payment requests (BTC-04)
// ---------------------------------------------------------------------------

/**
 * A NUT-18 request carries its own unit, but the machine's WalletContext is
 * always the ACTIVE-unit view and execution prepares proofs in that unit
 * while the payload stamps it. Flipping the flow unit to the request's unit
 * crossed the two contexts (cross-unit gates; proofs mislabelled in the
 * payload). Cross-unit requests now hard-stop with an actionable error.
 */
describe('transition — cross-unit payment requests', () => {
  it('rejects a usd-denominated request on a sat-unit wallet with an actionable error', () => {
    const result = tx('idle', idle, {
      type: 'EXECUTE',
      input: INPUTS.paymentRequestUsdNostr,
    });

    expect(result.step).toBe('error');
    expect(result.data).toMatchObject({ code: 'UNSUPPORTED_PAYMENT_METHOD' });
    expect((result.data as { message: string }).message).toContain('usd');
    // The flow unit must NOT have been flipped to the request's unit.
    expect(result.context.unit).toBe('sat');
    expect(result.context.amount).toBeUndefined();
  });

  it('accepts a same-unit request and seeds its amount', () => {
    const result = tx('idle', idle, {
      type: 'EXECUTE',
      input: INPUTS.paymentRequestSatNostr,
    });

    expect(result.step).toBe('navigateToPaymentRequest');
    expect(result.context.unit).toBe('sat');
    expect(result.context.amount).toBe(500);
  });

  it('treats an msat-precision bolt11 as a fixed invoice, rounded up (BTC-10)', () => {
    // 1100 msat → 2 sats: passes the integer validator, so the flow skips
    // amount entry instead of degrading to "amountless".
    const result = tx('idle', idle, {
      type: 'EXECUTE',
      input: INPUTS.bolt11MsatPrecision,
    });

    expect(result.context.amount).toBe(2);
    expect(result.step).not.toBe('enterAmount');
  });

  it('rejects a cross-unit request chosen from a multi-option input', () => {
    // Standalone parse gives a single-option parsed input; firing
    // OPTION_CHOSEN with it exercises the handleOptionChosen arm.
    const parsed = parsePaymentInput(INPUTS.paymentRequestUsdNostr, defaultDetectors);
    const option = parsed.options.find((o) => o.kind === 'paymentRequest');
    expect(option).toBeDefined();

    const result = tx(
      'chooseOption',
      { unit: 'sat', parsed },
      { type: 'OPTION_CHOSEN', option: option! },
      WALLETS.default
    );

    expect(result.step).toBe('error');
    expect(result.data).toMatchObject({ code: 'UNSUPPORTED_PAYMENT_METHOD' });
    expect(result.context.unit).toBe('sat');
  });
});

// ---------------------------------------------------------------------------
// EXECUTE — wallet state variations
// ---------------------------------------------------------------------------

/**
 * The same input can route differently depending on wallet state.
 * For example, a lightning address with no balance might still route
 * to enterAmount (the error surfaces later at mint selection), while
 * a cashu token always routes to receiveToken regardless of balance.
 */
describe('transition — EXECUTE with wallet states', () => {
  it('routes to error for no-balance wallet with lightning address', () => {
    // Lightning address needs balance to melt. With no balance, the
    // machine may either:
    //   - Route to enterAmount anyway (error surfaces at mint selection)
    //   - Route directly to error (fail-fast)
    // Both are valid strategies — the test accepts either.
    const result = tx(
      'idle',
      idle,
      { type: 'EXECUTE', input: INPUTS.lightningAddress },
      WALLETS.noBalance
    );
    expect(['enterAmount', 'error']).toContain(result.step);
  });

  it('routes ecash token regardless of wallet balance', () => {
    // Receiving a cashu token doesn't require balance — the token IS the
    // money. Even with zero balance, we can accept incoming ecash.
    const result = tx(
      'idle',
      idle,
      { type: 'EXECUTE', input: INPUTS.cashuTokenV3 },
      WALLETS.noBalance
    );
    expect(result.step).toBe('receiveToken');
  });
});

// ---------------------------------------------------------------------------
// START_SEND_ECASH — global event
// ---------------------------------------------------------------------------

/**
 * START_SEND_ECASH is triggered when the user taps the "Send" button
 * (not from scanning/pasting — that goes through EXECUTE). It enters
 * the send ecash flow which always needs an amount and a mint.
 *
 * Routing:
 *   - Has preferred mint with balance → enterAmount (mint pre-selected)
 *   - Multiple mints, no preferred → selectMint (user must choose)
 *   - No balance / no mints → error
 */
describe('transition — START_SEND_ECASH', () => {
  it('routes to enterAmount with preferred mint pre-selected', () => {
    // WALLETS.default has preferredMintUrl=MINT1 with balance.
    // Skip mint selection and go straight to amount entry.
    const result = tx('idle', idle, { type: 'START_SEND_ECASH' });
    expect(result.step).toBe('enterAmount');
    // destination='sendEcash' distinguishes this from mintQuote flows
    expect(result.context.destination).toBe('sendEcash');
  });

  it('routes to selectMint when no preferred mint', () => {
    // No preferred mint → must ask the user which mint to use
    const wallet = { ...WALLETS.default, preferredMintUrl: undefined };
    const result = tx('idle', idle, { type: 'START_SEND_ECASH' }, wallet);
    expect(result.step).toBe('selectMint');
  });

  it('routes to error when no balance', () => {
    // Can't send ecash with zero balance → error
    const result = tx('idle', idle, { type: 'START_SEND_ECASH' }, WALLETS.noBalance);
    expect(result.step).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// START_RECEIVE_LIGHTNING — global event
// ---------------------------------------------------------------------------

/**
 * START_RECEIVE_LIGHTNING creates a mint quote — the user wants to receive
 * sats via Lightning, which gets minted as ecash. The flow:
 *   1. Enter amount (how much to receive)
 *   2. Select mint (which mint creates the quote)
 *   3. The mint returns a Lightning invoice for the amount
 *
 * Unlike sending, receiving via Lightning works even with zero balance
 * (you're adding balance, not spending it).
 */
describe('transition — START_RECEIVE_LIGHTNING', () => {
  it('routes to enterAmount for mint quote', () => {
    const result = tx('idle', idle, { type: 'START_RECEIVE_LIGHTNING' });
    expect(result.step).toBe('enterAmount');
    // destination='mintQuote' tells downstream steps this is a receive flow
    expect(result.context.destination).toBe('mintQuote');
  });

  it('pre-selects preferred mint', () => {
    // The preferred mint is used for the quote — no need to ask the user
    const result = tx('idle', idle, { type: 'START_RECEIVE_LIGHTNING' });
    expect(result.context.mintUrl).toBe(MINT1);
  });

  it('skips the preferred mint when it cannot create Lightning receive quotes', () => {
    const wallet: WalletContext = {
      trustedMintUrls: [MINT1, MINT2],
      mintBalances: { [MINT1]: 1000, [MINT2]: 0 },
      preferredMintUrl: MINT1,
      proofAmounts: {},
      mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
        {
          mintUrl: MINT1,
          mintInfo: { nuts: { '4': { methods: [{ method: 'onchain', unit: 'sat' }] } } },
        },
        {
          mintUrl: MINT2,
          mintInfo: { nuts: { '4': { methods: [{ method: 'bolt11', unit: 'sat' }] } } },
        },
      ]),
    };

    const result = tx('idle', idle, { type: 'START_RECEIVE_LIGHTNING' }, wallet);

    expect(result.step).toBe('enterAmount');
    expect(result.context).toMatchObject({
      destination: 'mintQuote',
      mintQuoteMethod: 'bolt11',
      mintUrl: MINT2,
    });
  });
});

// ---------------------------------------------------------------------------
// START_RECEIVE — global event
// ---------------------------------------------------------------------------

/**
 * START_RECEIVE opens the receive hub — the method chooser (QR Display /
 * Scan QR / Fixed Amount / Paste). It's just a navigation event — no
 * payment logic involved.
 */
describe('transition — START_RECEIVE', () => {
  it('routes to receiveHub', () => {
    const result = tx('idle', idle, { type: 'START_RECEIVE' });
    expect(result.step).toBe('receiveHub');
  });
});

/**
 * SHOW_RECEIVE_QR opens the QR display (standing rails) from the hub with a
 * clean `{unit}` context, so a stale destination from a backed-out flow
 * (e.g. Fixed Amount) can never leak into it.
 */
describe('transition — SHOW_RECEIVE_QR', () => {
  it('routes to navigateToReceive with a clean context', () => {
    const staleCtx = { unit: 'sat', destination: 'mintQuote' as const };
    const result = tx('enterAmount', staleCtx, { type: 'SHOW_RECEIVE_QR' });
    expect(result.step).toBe('navigateToReceive');
    expect(result.context.destination).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// REQUEST_MINT_SELECTOR — global event
// ---------------------------------------------------------------------------

/**
 * REQUEST_MINT_SELECTOR is fired when the user taps the mint selector
 * button during enterAmount. It interrupts the current flow to show
 * the mint picker, then returns to the flow after selection.
 *
 * The candidates in the selectMint step vary based on the destination:
 *   - sendEcash: only mints with balance
 *   - mintQuote: all trusted mints (receiving doesn't need balance)
 */
describe('transition — REQUEST_MINT_SELECTOR', () => {
  it('routes to selectMint with candidates', () => {
    const result = tx(
      'enterAmount',
      { ...idle, destination: 'sendEcash' },
      {
        type: 'REQUEST_MINT_SELECTOR',
      }
    );
    expect(result.step).toBe('selectMint');
  });

  it('includes all trusted mints for mintQuote destination', () => {
    // For mint quotes (receiving), all trusted mints are valid candidates
    // because you don't need balance to create a quote.
    const ctx: FlowContext = { ...idle, destination: 'mintQuote' };
    const result = tx('enterAmount', ctx, { type: 'REQUEST_MINT_SELECTOR' });
    expect(result.step).toBe('selectMint');
  });

  it('keeps onchain receive intent and gates mints by onchain support when reopening the mint selector', () => {
    const wallet: WalletContext = {
      trustedMintUrls: [MINT1, MINT2],
      mintBalances: { [MINT1]: 1000, [MINT2]: 0 },
      preferredMintUrl: MINT1,
      proofAmounts: {},
      mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
        {
          mintUrl: MINT1,
          mintInfo: { nuts: { '4': { methods: [{ method: 'bolt11', unit: 'sat' }] } } },
        },
        {
          mintUrl: MINT2,
          mintInfo: { nuts: { '4': { methods: [{ method: 'onchain', unit: 'sat' }] } } },
        },
      ]),
    };
    const ctx: FlowContext = {
      ...idle,
      destination: 'mintQuote',
      mintQuoteMethod: 'onchain',
      amount: 500,
    };
    const result = tx('enterAmount', ctx, { type: 'REQUEST_MINT_SELECTOR' }, wallet);

    expect(result.step).toBe('selectMint');
    expect(result.data).toMatchObject({
      mintQuoteMethod: 'onchain',
      methodRequirement: { operation: 'mint', method: 'onchain', unit: 'sat' },
      candidates: [
        // coco v2 implements onchain minting: only MINT2 advertises it, so
        // the reopened selector lists it alone (bolt11-only MINT1 drops out).
        { mintUrl: MINT2, status: 'available' },
      ],
    });
  });

  it('drops a stale destination for an NPC-scoped request', () => {
    // Opening the npub.cash mint picker must ignore a lingering receive
    // destination so it shows the full trusted-mint list (not one filtered by
    // the stale method requirement) and leaves clean context behind it.
    const ctx: FlowContext = {
      ...idle,
      destination: 'mintQuote',
      mintQuoteMethod: 'bolt11',
      amount: 500,
    };
    const result = tx('enterAmount', ctx, { type: 'REQUEST_MINT_SELECTOR', scope: 'npc' });

    expect(result.step).toBe('selectMint');
    expect(result.context.destination).toBeUndefined();
    expect(result.data.scope).toBe('npc');
    expect(result.data.destination).toBeUndefined();
    expect(result.data.methodRequirement).toBeUndefined();
  });

  it('disables non-NUT-17 mints synchronously for the NPC scope', () => {
    // NPC receive needs NUT-17 websockets. The candidates must carry the
    // disabled status on the FIRST frame (from the cached capability map) so
    // the picker's initial order matches the enriched order — mints with
    // UNKNOWN info (never fetched) stay available for enrichment to decide.
    const wallet: WalletContext = {
      trustedMintUrls: [MINT1, MINT2, MINT3],
      mintBalances: { [MINT1]: 100, [MINT2]: 900, [MINT3]: 50 },
      preferredMintUrl: MINT1,
      proofAmounts: {},
      mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
        {
          mintUrl: MINT1,
          mintInfo: {
            nuts: { '4': { methods: [{ method: 'bolt11', unit: 'sat' }] } },
          },
        },
        {
          mintUrl: MINT2,
          mintInfo: {
            nuts: {
              '4': { methods: [{ method: 'bolt11', unit: 'sat' }] },
              '17': { supported: [{ method: 'bolt11', unit: 'sat', commands: [] }] },
            },
          },
        },
        // MINT3: no mintInfo at all — NUT-17 support unknown.
        { mintUrl: MINT3 },
      ]),
    };
    const result = tx('idle', idle, { type: 'REQUEST_MINT_SELECTOR', scope: 'npc' }, wallet);

    expect(result.step).toBe('selectMint');
    const byMint = Object.fromEntries(result.data.candidates.map((c) => [c.mintUrl, c]));
    expect(byMint[MINT1]).toMatchObject({
      status: 'disabled',
      reason: expect.objectContaining({ code: 'NO_WEBSOCKET' }),
    });
    expect(byMint[MINT2].status).toBeUndefined();
    expect(byMint[MINT3].status).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// REVIEW_MINT — global event
// ---------------------------------------------------------------------------

/**
 * REVIEW_MINT is triggered when the user receives a cashu token from an
 * untrusted mint. Before redeeming, the user must review and trust the
 * mint. The machine parks at reviewMint until the user decides.
 *
 * The reviewToken is stored in context so that after trusting, the machine
 * can continue to receiveToken with the original token.
 */
describe('transition — REVIEW_MINT', () => {
  it('routes to reviewMint step', () => {
    const result = tx('idle', idle, {
      type: 'REVIEW_MINT',
      mintUrl: MINT1,
      token: 'cashuAtest',
    });
    expect(result.step).toBe('reviewMint');
    // The token is saved so we can resume after trusting
    expect(result.context.reviewToken).toBe('cashuAtest');
  });
});

// ---------------------------------------------------------------------------
// MINT_TRUSTED — global event
// ---------------------------------------------------------------------------

/**
 * MINT_TRUSTED fires after the user approves the untrusted mint in the
 * review screen. If a reviewToken exists in context, the machine continues
 * to receiveToken to redeem it. If no reviewToken (shouldn't happen in
 * normal flow), the machine stays on reviewMint.
 */
describe('transition — MINT_TRUSTED', () => {
  it('routes to receiveToken when reviewToken exists', () => {
    const ctx: FlowContext = { ...idle, reviewToken: 'cashuAtest' };
    const result = tx('reviewMint', ctx, { type: 'MINT_TRUSTED' });
    expect(result.step).toBe('receiveToken');
    // reviewToken is consumed — cleared from context
    expect(result.context.reviewToken).toBeUndefined();
  });

  it('stays on current step when no reviewToken', () => {
    // Edge case: MINT_TRUSTED without a reviewToken. The machine has
    // nothing to continue with, so it stays on reviewMint.
    const result = tx('reviewMint', idle, { type: 'MINT_TRUSTED' });
    expect(result.step).toBe('reviewMint');
  });
});

// ---------------------------------------------------------------------------
// AMOUNT_ENTERED — state-specific
// ---------------------------------------------------------------------------

/**
 * AMOUNT_ENTERED fires when the user submits an amount in the enterAmount
 * screen. It advances the flow to the next step based on the destination:
 *   - sendEcash → confirmSend (then auto-resolves to sendComplete)
 *   - meltQuote → createMintQuote (then auto-resolves to mintQuoteCreated)
 *   - meltLightningAddress → navigateToMeltPreview
 *
 * The event carries amount, mintUrl, and optionally a new destination
 * (for flows that change mid-stream).
 */
describe('transition — AMOUNT_ENTERED', () => {
  it('advances flow after amount is entered with mint', () => {
    // Lightning address flow: enterAmount → navigateToMeltPreview
    // The meltTarget (lightning address) stays in context.
    const ctx: FlowContext = {
      ...idle,
      destination: 'sendEcash',
      intent: {
        type: 'meltLightningAddress',
        option: { kind: 'lightningAddress', value: 'user@example.com', source: 'standalone' },
      },
      meltTarget: 'user@example.com',
    };
    const result = tx('enterAmount', ctx, {
      type: 'AMOUNT_ENTERED',
      amount: 100,
      mintUrl: MINT1,
    });
    // Should advance past enterAmount to the next step
    expect(result.step).not.toBe('enterAmount');
    expect(result.context.amount).toBe(100);
  });

  it('resets context when destination changes', () => {
    // If the destination changes (e.g. user switches from sendEcash to
    // meltQuote), the old context should be replaced.
    const ctx: FlowContext = {
      ...idle,
      destination: 'sendEcash',
      amount: 50,
      mintUrl: MINT1,
    };
    const result = tx('enterAmount', ctx, {
      type: 'AMOUNT_ENTERED',
      amount: 200,
      mintUrl: MINT2,
      destination: 'meltQuote',
    });
    // New destination and values should replace old ones
    expect(result.context.destination).toBe('meltQuote');
    expect(result.context.amount).toBe(200);
  });

  it('preserves existing context when destination unchanged', () => {
    // When the destination stays the same, context fields like meltTarget
    // should survive the transition (they're still needed downstream).
    const ctx: FlowContext = {
      ...idle,
      destination: 'sendEcash',
      mintUrl: MINT1,
      meltTarget: 'user@example.com',
    };
    const result = tx('enterAmount', ctx, {
      type: 'AMOUNT_ENTERED',
      amount: 100,
      mintUrl: MINT1,
    });
    // meltTarget should still be there for the melt preview
    expect(result.context.meltTarget).toBe('user@example.com');
  });

  it('opens a method-aware mint selector for onchain receive on a non-supporting mint (coco v2)', () => {
    const wallet: WalletContext = {
      trustedMintUrls: [MINT1, MINT2],
      mintBalances: { [MINT1]: 1000, [MINT2]: 0 },
      preferredMintUrl: MINT1,
      proofAmounts: {},
      mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
        {
          mintUrl: MINT1,
          mintInfo: {
            nuts: {
              '4': { methods: [{ method: 'bolt11', unit: 'sat' }] },
            },
          },
        },
        {
          mintUrl: MINT2,
          mintInfo: {
            nuts: {
              '4': { methods: [{ method: 'onchain', unit: 'sat' }] },
            },
          },
        },
      ]),
    };
    const ctx: FlowContext = {
      ...idle,
      destination: 'mintQuote',
      mintQuoteMethod: 'onchain',
      mintUrl: MINT1,
    };
    const result = tx(
      'enterAmount',
      ctx,
      {
        type: 'AMOUNT_ENTERED',
        amount: 500,
        mintUrl: MINT1,
        destination: 'mintQuote',
        mintQuoteMethod: 'onchain',
      },
      wallet
    );

    // MINT1 (selected) is bolt11-only but MINT2 supports onchain — the
    // machine offers the method-aware selector instead of failing.
    expect(result.step).toBe('selectMint');
    expect(result.data).toMatchObject({
      methodRequirement: { operation: 'mint', method: 'onchain', unit: 'sat' },
    });
  });

  it('opens a method-aware mint selector when onchain receive is below the selected mint minimum', () => {
    const wallet: WalletContext = {
      trustedMintUrls: [MINT1, MINT2],
      mintBalances: { [MINT1]: 0, [MINT2]: 0 },
      preferredMintUrl: MINT1,
      proofAmounts: {},
      mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
        {
          mintUrl: MINT1,
          mintInfo: {
            nuts: {
              '4': { methods: [{ method: 'onchain', unit: 'sat', min_amount: 1_000 }] },
            },
          },
        },
        {
          mintUrl: MINT2,
          mintInfo: {
            nuts: {
              '4': { methods: [{ method: 'onchain', unit: 'sat', min_amount: 100 }] },
            },
          },
        },
      ]),
    };
    const ctx: FlowContext = {
      ...idle,
      destination: 'mintQuote',
      mintQuoteMethod: 'onchain',
      mintUrl: MINT1,
    };
    const result = tx(
      'enterAmount',
      ctx,
      {
        type: 'AMOUNT_ENTERED',
        amount: 500,
        mintUrl: MINT1,
        destination: 'mintQuote',
        mintQuoteMethod: 'onchain',
      },
      wallet
    );

    // 500 sat is below MINT1's advertised NUT-04 onchain minimum (1 000) but
    // clears MINT2's (100) — instead of creating a quote MINT1 would reject,
    // the machine offers the method-aware selector with MINT1 disabled.
    expect(result.step).toBe('selectMint');
    expect(result.data).toMatchObject({
      methodRequirement: { operation: 'mint', method: 'onchain', unit: 'sat' },
      candidates: [
        { mintUrl: MINT1, status: 'disabled', reason: { code: 'AMOUNT_BELOW_MINT_MIN' } },
        { mintUrl: MINT2, status: 'available' },
      ],
    });
  });

  it('opens a method-aware mint selector when Lightning melt is selected on an incompatible mint', () => {
    const wallet: WalletContext = {
      trustedMintUrls: [MINT1, MINT2],
      mintBalances: { [MINT1]: 1000, [MINT2]: 1000 },
      preferredMintUrl: MINT1,
      proofAmounts: {},
      mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
        {
          mintUrl: MINT1,
          mintInfo: {
            nuts: {
              '5': { methods: [{ method: 'onchain', unit: 'sat' }] },
            },
          },
        },
        {
          mintUrl: MINT2,
          mintInfo: {
            nuts: {
              '5': { methods: [{ method: 'bolt11', unit: 'sat' }] },
            },
          },
        },
      ]),
    };
    const ctx: FlowContext = {
      ...idle,
      destination: 'meltQuote',
      meltQuoteMethod: 'bolt11',
      mintUrl: MINT1,
      meltTarget: 'alice@example.com',
    };
    const result = tx(
      'enterAmount',
      ctx,
      {
        type: 'AMOUNT_ENTERED',
        amount: 500,
        mintUrl: MINT1,
        destination: 'meltQuote',
        meltQuoteMethod: 'bolt11',
        meltTarget: 'alice@example.com',
      },
      wallet
    );

    expect(result.step).toBe('selectMint');
    expect(result.data).toMatchObject({
      destination: 'meltQuote',
      meltQuoteMethod: 'bolt11',
      methodRequirement: { operation: 'melt', method: 'bolt11', unit: 'sat' },
      candidates: [
        { mintUrl: MINT1, status: 'disabled' },
        { mintUrl: MINT2, status: 'available' },
      ],
    });
  });

  it('opens the mint selector when Lightning melt is below the selected mint min but an alternate works', () => {
    const wallet: WalletContext = {
      trustedMintUrls: [MINT1, MINT2],
      mintBalances: { [MINT1]: 1000, [MINT2]: 1000 },
      preferredMintUrl: MINT1,
      proofAmounts: {},
      mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
        {
          mintUrl: MINT1,
          mintInfo: {
            nuts: {
              '5': { methods: [{ method: 'bolt11', unit: 'sat', min_amount: 1_000 }] },
            },
          },
        },
        {
          mintUrl: MINT2,
          mintInfo: {
            nuts: {
              '5': { methods: [{ method: 'bolt11', unit: 'sat', min_amount: 100 }] },
            },
          },
        },
      ]),
    };
    const ctx: FlowContext = {
      ...idle,
      destination: 'meltQuote',
      meltQuoteMethod: 'bolt11',
      mintUrl: MINT1,
      meltTarget: 'alice@example.com',
    };
    const result = tx(
      'enterAmount',
      ctx,
      {
        type: 'AMOUNT_ENTERED',
        amount: 500,
        mintUrl: MINT1,
        destination: 'meltQuote',
        meltQuoteMethod: 'bolt11',
        meltTarget: 'alice@example.com',
      },
      wallet
    );

    // 500 sat is below MINT1's advertised NUT-05 bolt11 minimum (1 000) but
    // clears MINT2's (100) — the melt no longer proceeds on a mint that would
    // reject the quote; the selector opens with MINT1 disabled.
    expect(result.step).toBe('selectMint');
    expect(result.data).toMatchObject({
      destination: 'meltQuote',
      meltQuoteMethod: 'bolt11',
      methodRequirement: { operation: 'melt', method: 'bolt11', unit: 'sat' },
      candidates: [
        { mintUrl: MINT1, status: 'disabled', reason: { code: 'AMOUNT_BELOW_MINT_MIN' } },
        { mintUrl: MINT2, status: 'available' },
      ],
    });
  });

  it('keeps the current mint when it can cover an ecash send amount', () => {
    const ctx: FlowContext = {
      ...idle,
      destination: 'sendEcash',
      mintUrl: MINT1,
    };
    const result = tx('enterAmount', ctx, {
      type: 'AMOUNT_ENTERED',
      amount: 200,
      mintUrl: MINT1,
    });

    expect(result.step).toBe('confirmSend');
    expect(result.context.mintUrl).toBe(MINT1);
    expect(result.data).toMatchObject({ mintUrl: MINT1, amount: 200 });
  });

  it('opens mint selector when an underfunded ecash send has one sufficient alternate mint', () => {
    const ctx: FlowContext = {
      ...idle,
      destination: 'sendEcash',
      mintUrl: MINT2,
    };
    const result = tx(
      'enterAmount',
      ctx,
      {
        type: 'AMOUNT_ENTERED',
        amount: 200,
        mintUrl: MINT2,
      },
      WALLETS.multiMintUnbalanced
    );

    expect(result.step).toBe('selectMint');
    expect(result.context.mintUrl).toBe(MINT2);
    expect(result.data).toMatchObject({
      candidates: [{ mintUrl: MINT1, balance: 5000 }],
      amount: 200,
      destination: 'sendEcash',
    });
  });

  it('opens the mint selector for ecash sends when multiple mints can cover the amount', () => {
    const wallet: WalletContext = {
      trustedMintUrls: [MINT1, MINT2, MINT3],
      mintBalances: { [MINT1]: 5000, [MINT2]: 4000, [MINT3]: 100 },
      preferredMintUrl: MINT3,
      proofAmounts: {
        [MINT1]: [2048, 1024, 512],
        [MINT2]: [2048, 1024, 512],
        [MINT3]: [64, 32, 4],
      },
    };
    const ctx: FlowContext = {
      ...idle,
      destination: 'sendEcash',
      mintUrl: MINT3,
    };
    const result = tx(
      'enterAmount',
      ctx,
      {
        type: 'AMOUNT_ENTERED',
        amount: 1000,
        mintUrl: MINT3,
      },
      wallet
    );

    expect(result.step).toBe('selectMint');
    expect(result.context).toMatchObject({
      amount: 1000,
      destination: 'sendEcash',
      mintUrl: MINT3,
    });
    expect(result.data).toMatchObject({
      amount: 1000,
      destination: 'sendEcash',
      candidates: [
        { mintUrl: MINT1, balance: 5000 },
        { mintUrl: MINT2, balance: 4000 },
      ],
    });
  });

  it('routes meltQuote amount entry to balance round-down when no online mint can cover the amount', () => {
    const ctx: FlowContext = {
      ...idle,
      destination: 'meltQuote',
      mintUrl: MINT1,
      meltTarget: 'user@example.com',
    };
    const result = tx(
      'enterAmount',
      ctx,
      {
        type: 'AMOUNT_ENTERED',
        amount: 9999,
        mintUrl: MINT1,
      },
      WALLETS.insufficientBalance
    );

    expect(result.step).toBe('chooseProofs');
    expect(result.context).toMatchObject({
      amount: 9999,
      destination: 'meltQuote',
      meltTarget: 'user@example.com',
    });
    expect(result.data).toMatchObject({
      suggestions: {
        roundDown: { amount: 50 },
        roundUp: null,
      },
    });
  });

  it('selects a sufficient meltQuote mint when amount entry provides no mintUrl', () => {
    const ctx: FlowContext = {
      ...idle,
      destination: 'meltQuote',
      meltTarget: 'user@example.com',
      recipientPubkey: 'recipient-pubkey',
      recipientProfile: {
        displayName: 'Recipient',
        avatarUrl: 'https://example.com/avatar.png',
        nip05: 'user@example.com',
      },
    };
    const result = tx(
      'enterAmount',
      ctx,
      {
        type: 'AMOUNT_ENTERED',
        amount: 200,
        mintUrl: '',
      },
      WALLETS.multiMintUnbalanced
    );

    expect(result.step).toBe('navigateToMeltPreview');
    expect(result.context.mintUrl).toBe(MINT1);
    expect(result.data).toMatchObject({
      mintUrl: MINT1,
      amount: 200,
      meltTarget: 'user@example.com',
      recipientPubkey: 'recipient-pubkey',
      recipientProfile: {
        displayName: 'Recipient',
        avatarUrl: 'https://example.com/avatar.png',
        nip05: 'user@example.com',
      },
    });
  });

  it('opens the mint selector when a payment request has one sufficient alternate mint', () => {
    const wallet: WalletContext = {
      trustedMintUrls: [MINT1, MINT2],
      mintBalances: { [MINT1]: 5000, [MINT2]: 3000 },
      preferredMintUrl: MINT1,
      proofAmounts: {
        [MINT1]: [2048, 1024, 512],
        [MINT2]: [2048, 1024, 512],
      },
    };
    const ctx: FlowContext = {
      ...idle,
      destination: 'paymentRequest',
      mintUrl: MINT1,
      paymentRequest: 'creq_test',
      supportedMintUrls: [MINT2],
    };
    const result = tx(
      'enterAmount',
      ctx,
      {
        type: 'AMOUNT_ENTERED',
        amount: 1000,
        mintUrl: MINT1,
      },
      wallet
    );

    expect(result.step).toBe('selectMint');
    expect(result.context).toMatchObject({
      mintUrl: MINT1,
      paymentRequest: 'creq_test',
      supportedMintUrls: [MINT2],
    });
    expect(result.data).toMatchObject({
      candidates: [{ mintUrl: MINT2, balance: 3000 }],
      paymentRequest: 'creq_test',
      amount: 1000,
      destination: 'paymentRequest',
    });
  });

  it('opens the mint selector for payment requests when multiple supported mints can cover the amount', () => {
    const wallet: WalletContext = {
      trustedMintUrls: [MINT1, MINT2, MINT3],
      mintBalances: { [MINT1]: 100, [MINT2]: 3000, [MINT3]: 4000 },
      preferredMintUrl: MINT1,
      proofAmounts: {
        [MINT1]: [64, 32, 4],
        [MINT2]: [2048, 1024, 512],
        [MINT3]: [2048, 1024, 512],
      },
    };
    const ctx: FlowContext = {
      ...idle,
      destination: 'paymentRequest',
      mintUrl: MINT1,
      paymentRequest: 'creq_test',
      supportedMintUrls: [MINT2, MINT3],
    };
    const result = tx(
      'enterAmount',
      ctx,
      {
        type: 'AMOUNT_ENTERED',
        amount: 1000,
        mintUrl: MINT1,
      },
      wallet
    );

    expect(result.step).toBe('selectMint');
    expect(result.context).toMatchObject({
      amount: 1000,
      destination: 'paymentRequest',
      mintUrl: MINT1,
      paymentRequest: 'creq_test',
      supportedMintUrls: [MINT2, MINT3],
    });
    expect(result.data).toMatchObject({
      amount: 1000,
      destination: 'paymentRequest',
      paymentRequest: 'creq_test',
      supportedMintUrls: [MINT2, MINT3],
      candidates: [
        { mintUrl: MINT3, balance: 4000 },
        { mintUrl: MINT2, balance: 3000 },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// MINT_SELECTED — state-specific
// ---------------------------------------------------------------------------

/**
 * MINT_SELECTED fires when the user picks a mint from the selectMint screen.
 * It stores the chosen mint in context and advances the flow.
 *
 * If the flow has an amount and destination, it advances to the next step
 * (confirmSend, navigateToMeltPreview, etc.). If not, it dismisses.
 */
describe('transition — MINT_SELECTED', () => {
  it('advances flow after mint selected', () => {
    // Flow already has amount (100) and destination (sendEcash).
    // After selecting MINT1, the flow advances to the confirmation step.
    const ctx: FlowContext = {
      ...idle,
      destination: 'sendEcash',
      amount: 100,
    };
    const result = tx('selectMint', ctx, {
      type: 'MINT_SELECTED',
      mintUrl: MINT1,
    });
    expect(result.context.mintUrl).toBe(MINT1);
    // Should advance past selectMint to the next step
    expect(result.step).not.toBe('selectMint');
  });

  it('routes to dismiss when no intent and no destination', () => {
    // selectMint with no destination and no intent → the user just picked
    // a mint but there's nothing to do with it → dismiss the flow.
    const result = tx('selectMint', idle, {
      type: 'MINT_SELECTED',
      mintUrl: MINT1,
    });
    expect(result.step).toBe('dismiss');
  });

  it('dismisses for an NPC-scoped selection and never advances the flow', () => {
    // NPC scope only sets which mint backs the npub.cash address. Even when a
    // stale `destination: mintQuote` lingers (e.g. the user opened Fixed Amount
    // then backed out), picking an NPC mint must NOT reopen the amount selector.
    const ctx: FlowContext = {
      ...idle,
      destination: 'mintQuote',
      mintQuoteMethod: 'bolt11',
    };
    const result = tx('selectMint', ctx, {
      type: 'MINT_SELECTED',
      mintUrl: MINT2,
      scope: 'npc',
    });
    expect(result.step).toBe('dismiss');
    // The stale receive context is dropped — only the chosen mint survives.
    expect(result.context.mintUrl).toBe(MINT2);
    expect(result.context.destination).toBeUndefined();
    expect(result.context.mintQuoteMethod).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PROOFS_CHOSEN — state-specific
// ---------------------------------------------------------------------------

/**
 * PROOFS_CHOSEN fires when the user selects a proof amount in the
 * offline proof picker (chooseProofs step). The amount may differ from
 * the original target if no exact match was possible (user chose to
 * round down or up).
 *
 * Routing after proof selection depends on the destination:
 *   - sendEcash → confirmSend (auto-resolves to sendComplete)
 *   - paymentRequest → navigateToPaymentRequest
 *   - meltQuote → navigateToMeltPreview
 */
describe('transition — PROOFS_CHOSEN', () => {
  it('routes to confirmSend for ecash destination', () => {
    const ctx: FlowContext = {
      ...idle,
      destination: 'sendEcash',
      mintUrl: MINT1,
      amount: 100,
      intent: {
        type: 'receiveToken',
        option: { kind: 'ecashToken', value: 'tok', source: 'standalone' },
      },
    };
    const result = tx('chooseProofs', ctx, {
      type: 'PROOFS_CHOSEN',
      amount: 96, // rounded down from 100 (no exact composition)
    });
    // confirmSend is the intermediate step before auto-execution
    expect(result.step).toBe('confirmSend');
    // Amount updated to the actually-composed amount (96, not 100)
    expect(result.context.amount).toBe(96);
  });

  it('routes to navigateToPaymentRequest when destination is paymentRequest', () => {
    const ctx: FlowContext = {
      ...idle,
      destination: 'paymentRequest',
      mintUrl: MINT1,
      paymentRequest: 'creq_test',
      amount: 100,
    };
    const result = tx('chooseProofs', ctx, {
      type: 'PROOFS_CHOSEN',
      amount: 100,
    });
    // Payment requests have their own terminal step
    expect(result.step).toBe('navigateToPaymentRequest');
  });

  it('routes to navigateToMeltPreview when destination is meltQuote', () => {
    const ctx: FlowContext = {
      ...idle,
      destination: 'meltQuote',
      mintUrl: MINT1,
      meltTarget: 'lnbc1...',
      amount: 100,
    };
    const result = tx('chooseProofs', ctx, {
      type: 'PROOFS_CHOSEN',
      amount: 100,
    });
    // Melt preview shows the user the final details before confirming
    expect(result.step).toBe('navigateToMeltPreview');
  });
});

// ---------------------------------------------------------------------------
// OPTION_CHOSEN — state-specific
// ---------------------------------------------------------------------------

/**
 * OPTION_CHOSEN fires when the user picks an option from the chooseOption
 * screen (BIP-321 multi-option). It re-resolves the intent for just the
 * chosen option and routes accordingly.
 *
 * When switching options, stale context from a previous option must be
 * cleared. For example, if the user initially explored the paymentRequest
 * option (which sets supportedMintUrls and paymentRequest in context),
 * then switches to lightningAddress, those fields must be removed.
 */
describe('transition — OPTION_CHOSEN', () => {
  it('returns error when no parsed input', () => {
    // Edge case: OPTION_CHOSEN without parsed input in context. This
    // shouldn't happen in normal flow, but the machine should handle
    // it gracefully by routing to error.
    const result = tx('chooseOption', idle, {
      type: 'OPTION_CHOSEN',
      option: { kind: 'ecashToken', value: 'tok', source: 'standalone' },
    });
    expect(result.step).toBe('error');
  });

  it('clears stale context fields when switching options', () => {
    // Context has paymentRequest and supportedMintUrls from exploring
    // the PR option. User switches to lightningAddress — those fields
    // are no longer relevant and must be cleared.
    const ctx: FlowContext = {
      ...idle,
      parsed: {
        raw: 'test',
        normalized: 'test',
        type: 'payment',
        container: 'bip321',
        options: [
          { kind: 'paymentRequest', value: 'creq_test', source: 'bip321' },
          { kind: 'lightningAddress', value: 'user@example.com', source: 'bip321' },
        ],
        warnings: [],
        errors: [],
      },
      // Stale fields from exploring the paymentRequest option:
      supportedMintUrls: [MINT1],
      paymentRequest: 'creq_test',
    };
    const result = tx('chooseOption', ctx, {
      type: 'OPTION_CHOSEN',
      option: { kind: 'lightningAddress', value: 'user@example.com', source: 'bip321' },
    });
    // Stale paymentRequest fields should be cleared
    expect(result.context.paymentRequest).toBeUndefined();
    expect(result.context.supportedMintUrls).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Unhandled events — stay on current step
// ---------------------------------------------------------------------------

/**
 * Events that the pure transition() function doesn't handle for a given
 * step return the current state unchanged. The machine wrapper
 * (createMachine) handles these at a higher level — for example,
 * CONFIRM_MELT is handled by createMachine's async operation execution,
 * not by the pure transition function.
 *
 * This "pass-through" behavior ensures the machine is resilient to
 * unexpected events without crashing.
 */
describe('transition — unhandled events', () => {
  it('returns current state for CONFIRM_MELT in transition (handled by createMachine)', () => {
    const ctx: FlowContext = { ...idle, mintUrl: MINT1 };
    const result = tx('navigateToMeltPreview', ctx, { type: 'CONFIRM_MELT' });
    // Same step, same context — event was not handled at this level
    expect(result.step).toBe('navigateToMeltPreview');
    expect(result.context).toBe(ctx);
  });
});
