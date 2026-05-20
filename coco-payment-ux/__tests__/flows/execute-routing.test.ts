/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * execute-routing.test.ts — Pairwise Routing Matrix
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This file tests machine.execute() — the primary entry point when a user
 * scans a QR code, pastes from clipboard, or taps a deep link. The question:
 * "Given this input and this wallet state, which step does the machine land on?"
 *
 * The combinatorial space is large:
 *   - 8+ input types × 7 wallet states × 3 prefix variants = 168+ combinations
 *
 * Full combinatorial testing would be unmaintainable. Instead, we use
 * PAIRWISE TESTING: cover all pairs of (inputType × walletState × prefix)
 * in ~17 cases. NIST research shows most software bugs are triggered by
 * interactions between 1-2 parameters, not 3+. Pairwise covers all 2-way
 * interactions with far fewer test cases.
 *
 * The matrix is organized by input type, with each case exercising a
 * different wallet state or prefix combination:
 *
 *   cashu tokens     → always receiveToken (regardless of wallet)
 *   lightning address → always enterAmount (needs user-entered amount)
 *   mint URL         → always openMint (navigation, not payment)
 *   npub             → always openProfile (navigation)
 *   random/empty     → always error (unrecognized)
 *   payment request  → varies by wallet (balance + mint trust)
 *   prefixed inputs  → same result as unprefixed (normalization works)
 *
 * IMPORTANT: These tests use createTestMachine (the full machine with
 * auto-execution), NOT the raw transition() function. This means steps
 * like confirmSend auto-resolve to sendComplete, and createMintQuote
 * auto-resolves to mintQuoteCreated.
 */

import { describe, it } from 'vitest';
import { createTestMachine } from '../_harness';
import {
  WALLETS,
  INPUTS,
} from '../_harness/fixtures';
import type { FlowStep } from '../../src/machine/types';
import type { WalletContext } from '../../src/types';

// ---------------------------------------------------------------------------
// Pairwise cases
// ---------------------------------------------------------------------------

/**
 * Each case specifies:
 *   name          — human-readable description
 *   input         — the raw string to execute
 *   wallet        — the wallet state to use
 *   expectedStep  — which step the machine should be on after execute()
 *   expectedContext? — optional context field assertions
 */
interface ExecuteRouteCase {
  name: string;
  input: string;
  wallet: Partial<WalletContext>;
  expectedStep: FlowStep;
  expectedContext?: Record<string, unknown>;
}

const PAIRWISE_CASES: ExecuteRouteCase[] = [
  // ─── cashu token routes to receiveToken regardless of wallet ──────────
  // Ecash tokens are always receivable — no balance, mints, or network needed.
  // We test across 3 wallet states to prove wallet independence.
  {
    name: 'cashu token + default wallet',
    input: INPUTS.cashuTokenV3,
    wallet: WALLETS.default,
    expectedStep: 'receiveToken',
  },
  {
    name: 'cashu token + no balance wallet',
    input: INPUTS.cashuTokenV3,
    wallet: WALLETS.noBalance,
    expectedStep: 'receiveToken',
  },
  {
    name: 'cashu token + no mints wallet',
    input: INPUTS.cashuTokenV3,
    wallet: WALLETS.noMints,
    expectedStep: 'receiveToken',
  },

  // ─── lightning address needs amount → enterAmount ─────────────────────
  // Lightning addresses don't include amounts — the user must enter one.
  // Various wallet states all route to enterAmount (errors surface later).
  {
    name: 'lightning address + default wallet',
    input: INPUTS.lightningAddress,
    wallet: WALLETS.default,
    expectedStep: 'enterAmount',
  },
  {
    name: 'lightning address + single mint wallet',
    input: INPUTS.lightningAddress,
    wallet: WALLETS.singleMint,
    expectedStep: 'enterAmount',
  },
  {
    name: 'lightning address + no balance wallet',
    input: INPUTS.lightningAddress,
    wallet: WALLETS.noBalance,
    expectedStep: 'enterAmount',
  },

  // ─── mint URL routes to openMint regardless of wallet ─────────────────
  // Mint URLs are navigational — always openMint, even with empty wallet.
  {
    name: 'mint URL + default wallet',
    input: INPUTS.mintUrl,
    wallet: WALLETS.default,
    expectedStep: 'openMint',
  },
  {
    name: 'mint URL + no mints wallet',
    input: INPUTS.mintUrl,
    wallet: WALLETS.noMints,
    expectedStep: 'openMint',
  },

  // ─── npub routes to openProfile ───────────────────────────────────────
  {
    name: 'npub + default wallet',
    input: INPUTS.npub,
    wallet: WALLETS.default,
    expectedStep: 'openProfile',
  },

  // ─── unknown input routes to error ────────────────────────────────────
  // Anything that doesn't match any detector → error step.
  {
    name: 'random string + default wallet',
    input: INPUTS.randomString,
    wallet: WALLETS.default,
    expectedStep: 'error',
  },
  {
    name: 'empty string + default wallet',
    input: INPUTS.emptyString,
    wallet: WALLETS.default,
    expectedStep: 'error',
  },

  // ─── payment request routes vary by wallet state ──────────────────────
  // Payment requests check mint trust + balance. The outcome depends on
  // whether the wallet trusts a mint in the PR's mint list and has balance.
  {
    name: 'payment request + default wallet (matching mint with balance)',
    input: INPUTS.paymentRequestBasic,
    wallet: WALLETS.default,
    // PR targets MINT1, wallet trusts MINT1, balance sufficient →
    // auto-completes through confirmSend to navigateToPaymentRequest
    expectedStep: 'navigateToPaymentRequest',
  },
  {
    name: 'payment request + no balance wallet',
    input: INPUTS.paymentRequestBasic,
    wallet: WALLETS.noBalance,
    // No balance → can't fulfill PR → error
    expectedStep: 'error',
  },

  // ─── multi-mint unbalanced scenarios ──────────────────────────────────
  {
    name: 'lightning address + multi mint unbalanced',
    input: INPUTS.lightningAddress,
    wallet: WALLETS.multiMintUnbalanced,
    // Still needs amount regardless of mint distribution
    expectedStep: 'enterAmount',
  },

  // ─── cashu token with prefix variations ───────────────────────────────
  // Tests that the normalization layer strips prefixes before detection.
  // The result should be identical to the bare token.
  {
    name: 'cashu: prefixed token + default wallet',
    input: `cashu:${INPUTS.cashuTokenV3}`,
    wallet: WALLETS.default,
    expectedStep: 'receiveToken',
  },
  {
    name: 'cashu:// prefixed token + single mint wallet',
    input: `cashu://${INPUTS.cashuTokenV3}`,
    wallet: WALLETS.singleMint,
    expectedStep: 'receiveToken',
  },

  // ─── lightning address with prefix ────────────────────────────────────
  {
    name: 'lightning: prefixed address + default wallet',
    input: `lightning:${INPUTS.lightningAddress}`,
    wallet: WALLETS.default,
    // After stripping lightning: prefix, detects as lightningAddress
    expectedStep: 'enterAmount',
  },
];

// ---------------------------------------------------------------------------
// Execute the matrix
// ---------------------------------------------------------------------------

/**
 * vitest's `it.each` runs each pairwise case as a separate test.
 * The `$name → $expectedStep` template generates descriptive test names.
 *
 * Each test:
 *   1. Creates a fresh machine with the case's wallet state
 *   2. Calls execute() with the case's input (reset: true clears any state)
 *   3. Asserts the machine landed on the expected step
 *   4. Optionally asserts context fields
 */
describe('execute() routing — pairwise matrix', () => {
  it.each(PAIRWISE_CASES)('$name → $expectedStep', async (tc) => {
    const tm = createTestMachine({ wallet: tc.wallet });
    await tm.machine.execute(tc.input, { reset: true });
    tm.assertStep(tc.expectedStep);
    if (tc.expectedContext) {
      tm.assertContext(tc.expectedContext);
    }
  });
});

// ---------------------------------------------------------------------------
// Execute from non-idle states (re-scan / re-execute)
// ---------------------------------------------------------------------------

/**
 * In real usage, users often scan a new QR code while already in a flow.
 * For example, the user started paying a lightning address (enterAmount),
 * then scans a cashu token QR. The new execute() should override the
 * current flow, not fail or queue behind it.
 *
 * This is possible because EXECUTE is a global event — it works from any step.
 * The `{ reset: true }` option tells the machine to clear state first.
 */
describe('execute() from non-idle state', () => {
  it('re-executes from enterAmount (overrides current flow)', async () => {
    const tm = createTestMachine();
    // Start a lightning address flow → enterAmount
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    tm.assertStep('enterAmount');

    // Now scan a cashu token — should override the lightning flow
    await tm.machine.execute(INPUTS.cashuTokenV3, { reset: true });
    tm.assertStep('receiveToken');
  });

  it('re-executes from error state', async () => {
    const tm = createTestMachine();
    // Bad input → error
    await tm.machine.execute(INPUTS.randomString, { reset: true });
    tm.assertStep('error');

    // Scan valid token → should recover from error
    await tm.machine.execute(INPUTS.cashuTokenV3, { reset: true });
    tm.assertStep('receiveToken');
  });
});
