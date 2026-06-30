// ---------------------------------------------------------------------------
// Guards & Validation
//
// Validates a resolved intent against wallet context. Returns a list of
// guard results (pass/fail + reason). Wallets can use this to show
// warnings, block actions, or surface specific error messages.
// ---------------------------------------------------------------------------

import type {
  ResolvedIntent,
  WalletContext,
  GuardResult,
  WalletCapability,
  CapabilityCheckResult,
} from "./types";
import { logger } from "./logger";

// 21M BTC × 1e8 sats/BTC. Anything beyond is not a representable Bitcoin
// amount; cashu mints reject it and our sat-mode math assumes safe-int.
export const MAX_SAT_AMOUNT = 2_100_000_000_000_000;

/**
 * True iff `n` is a positive, finite, safe-integer sat amount within the
 * total Bitcoin supply. Use at every boundary that accepts an amount from
 * an untrusted source — payment requests, BIP-321 query params, intent
 * options — before assigning to a flow context. Floating-point fiat values
 * must be converted to sats first; this helper deliberately rejects them.
 */
export function isValidSatAmount(n: unknown): n is number {
  return (
    typeof n === "number" &&
    Number.isSafeInteger(n) &&
    n > 0 &&
    n <= MAX_SAT_AMOUNT
  );
}

function summarizeIntent(intent: ResolvedIntent): Record<string, unknown> {
  switch (intent.type) {
    case "receiveToken":
      return {
        optionKind: intent.option.kind,
        optionSource: intent.option.source,
      };
    case "sendPaymentRequest":
      return {
        optionKind: intent.option.kind,
        optionSource: intent.option.source,
        requestedMintCount: intent.info.mints.length,
        hasAmount: intent.info.amount != null,
        unit: intent.info.unit,
        transportTypes:
          intent.info.transports?.map((transport) => transport.type) ?? [],
      };
    case "meltLightningInvoice":
    case "meltLightningAddress":
    case "meltLnurlp":
    case "meltOnchainAddress":
      return {
        optionKind: intent.option.kind,
        optionSource: intent.option.source,
        hasAmount: intent.option.amount != null,
      };
    case "openMint":
      return { hasUrl: !!intent.url };
    case "openProfile":
      return { hasNpub: !!intent.npub };
    case "chooseOption":
      return {
        optionCount: intent.options.length,
        optionKinds: intent.options.map((option) => option.option.kind),
        statuses: intent.options.map((option) => option.status),
      };
    case "ignore":
      return { reasonCode: intent.reason.code };
  }
}

function summarizeGuards(results: GuardResult[]): {
  guard: string;
  passed: boolean;
  reasonCode: string | undefined;
}[] {
  return results.map((result) => ({
    guard: result.guard,
    passed: result.passed,
    reasonCode: result.reason?.code,
  }));
}

// ---------------------------------------------------------------------------
// Intent validation
// ---------------------------------------------------------------------------

export function validateIntent(
  intent: ResolvedIntent,
  ctx: WalletContext,
): GuardResult[] {
  const results: GuardResult[] = [];
  logger.debug("guards.validateIntent.start", {
    intentType: intent.type,
    trustedMintCount: ctx.trustedMintUrls.length,
    balanceMintCount: Object.keys(ctx.mintBalances).length,
    proofMintCount: Object.keys(ctx.proofAmounts).length,
    ...summarizeIntent(intent),
  });

  switch (intent.type) {
    case "sendPaymentRequest": {
      const info = intent.info;

      // Mint support guard
      if (info.mints.length > 0) {
        const anyTrusted = info.mints.some((m) =>
          ctx.trustedMintUrls.includes(m),
        );
        results.push({
          guard: "mintSupport",
          passed: anyTrusted,
          reason: anyTrusted
            ? undefined
            : {
                code: "MINT_NOT_TRUSTED",
                message:
                  "Payment request specifies mints that are not in your trusted set",
              },
        });
      }

      // Balance guard
      if (info.amount != null && info.amount > 0) {
        const candidateMints =
          info.mints.length > 0
            ? info.mints.filter((m) => ctx.trustedMintUrls.includes(m))
            : ctx.trustedMintUrls;

        const hasSufficient = candidateMints.some(
          (m) => (ctx.mintBalances[m] ?? 0) >= info.amount!,
        );
        results.push({
          guard: "balance",
          passed: hasSufficient,
          reason: hasSufficient
            ? undefined
            : {
                code: "INSUFFICIENT_BALANCE",
                message: `Insufficient balance for ${info.amount} ${info.unit || "sat"}`,
              },
        });
      }

      // Transport guard
      if (info.transports && info.transports.length > 0) {
        const hasHttp = info.transports.some(
          (t) => t.type === "post" || t.type === "http",
        );
        if (hasHttp) {
          results.push({
            guard: "httpTransport",
            passed: true,
            reason: undefined,
          });
        }
      }

      break;
    }

    case "meltLightningInvoice": {
      const total = Object.values(ctx.mintBalances).reduce((a, b) => a + b, 0);
      const amount = intent.option.amount;

      results.push({
        guard: "balance",
        passed: total > 0,
        reason:
          total > 0
            ? undefined
            : {
                code: "NO_BALANCE",
                message: "No balance available for Lightning payment",
              },
      });

      if (amount != null && amount > 0) {
        results.push({
          guard: "balanceSufficient",
          passed: total >= amount,
          reason:
            total >= amount
              ? undefined
              : {
                  code: "INSUFFICIENT_BALANCE",
                  message: `Total balance (${total}) is less than invoice amount (${amount})`,
                },
        });
      }

      // Amount guard — Lightning invoice should have an amount for melt
      results.push({
        guard: "amountPresent",
        passed: amount != null && amount > 0,
        reason:
          amount != null && amount > 0
            ? undefined
            : {
                code: "NO_AMOUNT",
                message:
                  "Invoice has no amount — wallet must collect amount from user",
              },
      });

      break;
    }

    case "meltLightningAddress":
    case "meltLnurlp": {
      const total = Object.values(ctx.mintBalances).reduce((a, b) => a + b, 0);

      results.push({
        guard: "balance",
        passed: total > 0,
        reason:
          total > 0
            ? undefined
            : {
                code: "NO_BALANCE",
                message: "No balance available for Lightning payment",
              },
      });

      // Amount is always required (must be collected from user)
      results.push({
        guard: "amountRequired",
        passed: false,
        reason: {
          code: "NO_AMOUNT",
          message: "Amount must be entered by user before paying",
        },
      });

      break;
    }

    case "receiveToken":
      // No guards needed for receiving
      break;

    case "openMint":
    case "openProfile":
      // No guards needed for navigation intents
      break;

    case "chooseOption":
      // Guard: at least one option must not be disabled
      if (intent.options.length > 0) {
        const hasNonDisabled = intent.options.some(
          (o) => o.status !== "disabled",
        );
        results.push({
          guard: "hasViableOption",
          passed: hasNonDisabled,
          reason: hasNonDisabled
            ? undefined
            : {
                code: "ALL_OPTIONS_DISABLED",
                message: "All payment options are disabled",
              },
        });
      }
      break;

    case "ignore":
      results.push({
        guard: "supported",
        passed: false,
        reason: intent.reason,
      });
      break;
  }

  logger.info("guards.validateIntent.result", {
    intentType: intent.type,
    guardCount: results.length,
    failedGuardCount: results.filter((result) => !result.passed).length,
    guards: summarizeGuards(results),
  });
  return results;
}

// ---------------------------------------------------------------------------
// Wallet capability completeness check
//
// Given a set of capabilities the wallet supports, checks whether all
// capabilities required by a particular intent are covered. This lets
// wallets verify at build time (or test time) that they've implemented
// all necessary flows.
// ---------------------------------------------------------------------------

const CAPABILITIES_BY_INTENT: Record<string, WalletCapability[]> = {
  receiveToken: ["tokenReceive"],
  sendPaymentRequest: [
    "amountEntry",
    "mintSelection",
    "proofSelection",
    "httpTransport",
  ],
  meltLightningInvoice: ["mintSelection", "proofSelection", "meltQuoteFetch"],
  meltLightningAddress: [
    "amountEntry",
    "mintSelection",
    "proofSelection",
    "meltQuoteFetch",
  ],
  meltLnurlp: [
    "amountEntry",
    "mintSelection",
    "proofSelection",
    "meltQuoteFetch",
  ],
  openMint: ["mintInfo"],
  openProfile: ["profileView"],
  chooseOption: ["optionSelection"],
};

export function checkWalletCapabilities(
  walletCapabilities: Set<WalletCapability>,
  intent: ResolvedIntent,
): CapabilityCheckResult {
  const required = CAPABILITIES_BY_INTENT[intent.type] ?? [];
  const missing = required.filter((c) => !walletCapabilities.has(c));
  const result = { covered: missing.length === 0, missing };
  logger.info("guards.capabilities.intent", {
    intentType: intent.type,
    providedCount: walletCapabilities.size,
    required,
    missing,
    covered: result.covered,
  });
  return result;
}

/**
 * Check all possible intent types against the wallet's capabilities.
 * Returns the list of intent types that have missing capabilities.
 */
export function checkAllCapabilities(
  walletCapabilities: Set<WalletCapability>,
): { intentType: string; missing: WalletCapability[] }[] {
  const gaps: { intentType: string; missing: WalletCapability[] }[] = [];

  for (const [intentType, required] of Object.entries(CAPABILITIES_BY_INTENT)) {
    const missing = required.filter((c) => !walletCapabilities.has(c));
    if (missing.length > 0) {
      gaps.push({ intentType, missing });
    }
  }

  logger.info("guards.capabilities.all", {
    providedCount: walletCapabilities.size,
    gapCount: gaps.length,
    gaps,
  });
  return gaps;
}
