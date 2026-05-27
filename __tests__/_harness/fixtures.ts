/**
 * ═══════════════════════════════════════════════════════════════════════════
 * fixtures.ts — Test Data: Wallet States & Input Strings
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Centralized test data used across all test files. Having fixtures in one
 * place ensures:
 *   - Consistent wallet states across tests (no subtle differences)
 *   - Real, valid encoded strings (detectors use real libraries)
 *   - Easy reference from test assertions (MINT1, WALLETS.default, etc.)
 *
 * WALLET FIXTURES model different user scenarios:
 *   default         — The "normal" user: 2 mints, good balances, preferred mint
 *   singleMint      — New user: only one mint added
 *   noBalance       — Spent everything: mint trusted but 0 balance
 *   noMints         — Brand new app: no mints added yet
 *   multiMintUnbalanced — Power user: 3 mints with very different balances
 *   insufficientBalance — Low balance: can't cover large payments
 *   noExactProofs   — Offline edge case: proofs that can't compose exact amounts
 *
 * INPUT FIXTURES are real encoded strings that pass production detectors:
 *   - cashuTokenV3: Real base64-encoded V3 token with valid proof structure
 *   - npub: Real bech32-encoded Nostr public key (valid checksum)
 *   - paymentRequestBasic: Real CBOR-encoded payment request
 *   - Others are format-matched strings that pass detector regex
 */

import { deriveMintMethodCapabilityMapFromTrustedMints } from '../../src/mint-capabilities';
import type { WalletContext } from '../../src/types';

// ---------------------------------------------------------------------------
// Mint URLs — stable test constants
// ---------------------------------------------------------------------------

/** Primary test mint. Used as the "good" mint in most tests. */
export const MINT1 = 'https://mint1.example.com';

/** Secondary test mint. Used for multi-mint scenarios. */
export const MINT2 = 'https://mint2.example.com';

/** Tertiary test mint. Used for the multiMintUnbalanced wallet (3 mints). */
export const MINT3 = 'https://mint3.example.com';

/** A mint URL that NO wallet fixture trusts. Used for negative tests. */
export const UNTRUSTED_MINT = 'https://untrusted.example.com';

/**
 * Mint metadata — simulates what getAllTrustedMints() returns from the Manager.
 * Used by mock buildMintListItems to return realistic displayName/iconUrl
 * instead of echoing back raw URLs.
 */
export const MINT_METADATA: Record<string, { displayName: string; iconUrl: string }> = {
  [MINT1]: { displayName: 'Mint One', iconUrl: 'https://mint1.example.com/icon.png' },
  [MINT2]: { displayName: 'Mint Two', iconUrl: 'https://mint2.example.com/icon.png' },
  [MINT3]: { displayName: 'Mint Three', iconUrl: 'https://mint3.example.com/icon.png' },
};

const BOLT11_SAT_MINT_INFO = {
  nuts: {
    '4': { methods: [{ method: 'bolt11', unit: 'sat' }] },
    '5': { methods: [{ method: 'bolt11', unit: 'sat' }] },
  },
};

function bolt11SatCapabilities(mintUrls: readonly string[]): WalletContext['mintMethodCapabilities'] {
  return deriveMintMethodCapabilityMapFromTrustedMints(
    mintUrls.map((mintUrl) => ({ mintUrl, mintInfo: BOLT11_SAT_MINT_INFO }))
  );
}

// ---------------------------------------------------------------------------
// Wallet state fixtures
// ---------------------------------------------------------------------------

export const WALLETS = {
  /**
   * DEFAULT — The "normal" wallet state.
   * 2 trusted mints with good balances and a preferred mint.
   *
   * MINT1: 1000 sats, power-of-2 proofs (can compose any amount 1-1023)
   * MINT2: 500 sats, power-of-2 proofs (can compose any amount 1-511)
   * Preferred: MINT1
   */
  default: {
    trustedMintUrls: [MINT1, MINT2],
    mintBalances: { [MINT1]: 1000, [MINT2]: 500 },
    mintMethodCapabilities: bolt11SatCapabilities([MINT1, MINT2]),
    preferredMintUrl: MINT1,
    proofAmounts: {
      [MINT1]: [1, 2, 4, 8, 16, 32, 64, 128, 256, 512],
      [MINT2]: [1, 2, 4, 8, 16, 32, 64, 128, 256],
    },
  },

  /**
   * SINGLE MINT — User has only one mint.
   * Auto-selection always picks MINT1 (the only option).
   */
  singleMint: {
    trustedMintUrls: [MINT1],
    mintBalances: { [MINT1]: 1000 },
    mintMethodCapabilities: bolt11SatCapabilities([MINT1]),
    preferredMintUrl: MINT1,
    proofAmounts: {
      [MINT1]: [1, 2, 4, 8, 16, 32, 64, 128, 256, 512],
    },
  },

  /**
   * NO BALANCE — Mint is trusted but has zero balance.
   * Sending and melting should fail; receiving tokens should still work.
   */
  noBalance: {
    trustedMintUrls: [MINT1],
    mintBalances: { [MINT1]: 0 },
    mintMethodCapabilities: bolt11SatCapabilities([MINT1]),
    preferredMintUrl: MINT1,
    proofAmounts: {},
  },

  /**
   * NO MINTS — Brand new wallet with no trusted mints.
   * Everything except token receive should fail (tokens carry their own mint).
   */
  noMints: {
    trustedMintUrls: [],
    mintBalances: {},
    proofAmounts: {},
  },

  /**
   * MULTI-MINT UNBALANCED — 3 mints with very different balances.
   * Tests the preference-vs-capability trade-off:
   *   MINT1: 5000 sats (highest balance)
   *   MINT2: 100 sats (preferred but low balance)
   *   MINT3: 0 sats (trusted but empty)
   *
   * For small amounts, MINT2 (preferred) is used.
   * For larger amounts, MINT1 (most balance) is needed.
   */
  multiMintUnbalanced: {
    trustedMintUrls: [MINT1, MINT2, MINT3],
    mintBalances: { [MINT1]: 5000, [MINT2]: 100, [MINT3]: 0 },
    mintMethodCapabilities: bolt11SatCapabilities([MINT1, MINT2, MINT3]),
    preferredMintUrl: MINT2,
    proofAmounts: {
      [MINT1]: [1024, 2048, 512, 256, 128, 32],
      [MINT2]: [64, 32, 4],
    },
  },

  /**
   * INSUFFICIENT BALANCE — Has balance but too little for most payments.
   * Used to test balance guard failures (50 sats can't cover 100-sat PRs).
   */
  insufficientBalance: {
    trustedMintUrls: [MINT1],
    mintBalances: { [MINT1]: 50 },
    mintMethodCapabilities: bolt11SatCapabilities([MINT1]),
    preferredMintUrl: MINT1,
    proofAmounts: { [MINT1]: [32, 16, 2] },
  },

  /**
   * NO EXACT PROOFS — Has balance but proofs can't compose exact amounts.
   * Proofs: [512, 256, 128, 64, 32, 8] = 1000 total.
   * Missing: 1, 2, 4, 16 — so amounts like 100 can't be composed exactly.
   *   Nearest lower: 96 (64+32) or 104 (64+32+8).
   *
   * This triggers the chooseProofs step for offline/ecash sends.
   */
  noExactProofs: {
    trustedMintUrls: [MINT1],
    mintBalances: { [MINT1]: 1000 },
    mintMethodCapabilities: bolt11SatCapabilities([MINT1]),
    preferredMintUrl: MINT1,
    proofAmounts: { [MINT1]: [512, 256, 128, 64, 32, 8] },
  },
} as const satisfies Record<string, WalletContext>;

export type WalletFixtureName = keyof typeof WALLETS;

// ---------------------------------------------------------------------------
// Input fixtures
//
// These are real-format strings where possible. For cashu tokens
// and bolt11 invoices, we generate minimal valid examples. The parse
// layer uses real detectors (@cashu/cashu-ts, bolt11-decode, nostr-tools).
// ---------------------------------------------------------------------------

export const INPUTS = {
  // ── Cashu tokens ────────────────────────────────────────────────────
  /**
   * Minimal V3 cashu token targeting MINT1. Base64-decoded, this is:
   * { token: [{ mint: "https://mint1.example.com", proofs: [{ amount: 1, secret: "abc", C: "02abc", id: "00ad268c" }] }], unit: "sat" }
   *
   * This is a real, valid token that @cashu/cashu-ts can decode.
   * The proof values are synthetic but structurally valid.
   */
  cashuTokenV3:
    'cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vbWludDEuZXhhbXBsZS5jb20iLCJwcm9vZnMiOlt7ImFtb3VudCI6MSwic2VjcmV0IjoiYWJjIiwiQyI6IjAyYWJjIiwiaWQiOiIwMGFkMjY4YyJ9XX1dLCJ1bml0Ijoic2F0In0=',

  // ── Lightning ───────────────────────────────────────────────────────
  /** Standard lightning address format (user@domain) */
  lightningAddress: 'user@walletofsatoshi.com',

  /** LNURL-pay URL. Note: raw HTTPS URLs are classified as mint URLs.
   * Use lnurlp:// prefix in tests that need lnurlp detection. */
  lnurlpUrl: 'https://pay.walletofsatoshi.com/lnurlp/xyz',

  // ── Payment requests ────────────────────────────────────────────────
  /**
   * Real CBOR-encoded payment request generated by:
   * new PaymentRequest([{type:'post',target:'https://mint1.example.com'}],
   *   undefined, 100, 'sat', ['https://mint1.example.com'])
   *
   * Decodes to: transport=POST to MINT1, amount=100, unit=sat, mints=[MINT1]
   */
  paymentRequestBasic: 'creqApGF0gaNhdGRwb3N0YWF4GWh0dHBzOi8vbWludDEuZXhhbXBsZS5jb21hZ/dhYRhkYXVjc2F0YW2BeBlodHRwczovL21pbnQxLmV4YW1wbGUuY29t',

  // ── Mint URLs ───────────────────────────────────────────────────────
  /** Alias for MINT1 — detected as a mint URL (https://) */
  mintUrl: MINT1,

  /** Same URL with trailing slash — should normalize to same mint */
  mintUrlWithTrailingSlash: `${MINT1}/`,

  // ── Nostr npub ──────────────────────────────────────────────────────
  /**
   * Real bech32-encoded Nostr public key with valid checksum.
   * Generated by nip19.npubEncode() with a test hex public key
   * (all zeros: 0000...0000). Passes nostr-tools validation.
   */
  npub: 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqshp52w2',

  // ── BIP-321 ─────────────────────────────────────────────────────────
  /** bitcoin: URI with only a lightning parameter */
  bip321LightningOnly: 'bitcoin:?lightning=lnbc1u1p0test',

  // ── Unsupported / invalid ───────────────────────────────────────────
  /** Random English text — matches no detector */
  randomString: 'hello world this is not a valid payment input',

  /** Empty string — triggers "Empty input" error */
  emptyString: '',
} as const;

export type InputFixtureName = keyof typeof INPUTS;
