// ---------------------------------------------------------------------------
// Parsing & Classification
//
// Takes raw input + wallet-provided detectors → ParsedPaymentInput.
// Handles standalone strings, BIP-321 containers, UR fragments, mint URLs,
// and npubs. Deduplicates equivalent options across variants.
// ---------------------------------------------------------------------------

import {
  sanitizeInput,
  safeDecodeURIComponent,
  stripCashuPrefixes,
  stripLightningPrefixes,
  inputVariants,
} from "./normalize";
import { logger } from "./logger";
import type {
  Detectors,
  PaymentOption,
  PaymentOptionKind,
  Bip321Container,
  ParsedPaymentInput,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KNOWN_BIP321_KEYS = new Set([
  "amount",
  "label",
  "message",
  "pop",
  "req-pop",
  "lightning",
  "lno",
  "pay",
  "sp",
  "pj",
  "req-pj",
  "r",
  "creq",
  "cashu",
  "token",
  "bc",
  "tb",
  "bcrt",
]);

const UNSUPPORTED_REQUIRED_BIP321_KEYS = new Set(["req-pop", "req-pj"]);
const ONCHAIN_ADDRESS_PARAM_KEYS = new Set(["bc", "tb", "bcrt"]);
const ONCHAIN_INSTRUCTION_PARAM_KEYS = new Set(["pay", "sp"]);

const OPTION_PRIORITY: Record<PaymentOptionKind, number> = {
  paymentRequest: 0,
  ecashToken: 1,
  lightningInvoice: 2,
  lightningAddress: 3,
  lnurlp: 4,
  onchainAddress: 5,
};

// ---------------------------------------------------------------------------
// Dedup helpers
// ---------------------------------------------------------------------------

function dedupeKey(option: PaymentOption): string {
  if (option.kind === "ecashToken") return `${option.kind}:${option.value}`;
  return `${option.kind}:${option.value.toLowerCase()}`;
}

function pushOption(
  target: PaymentOption[],
  option: PaymentOption,
  seen: Set<string>,
): void {
  const key = dedupeKey(option);
  if (seen.has(key)) return;
  seen.add(key);
  target.push(option);
}

function sortOptions(options: PaymentOption[]): PaymentOption[] {
  return [...options].sort(
    (a, b) => OPTION_PRIORITY[a.kind] - OPTION_PRIORITY[b.kind],
  );
}

function summarizeOptions(options: PaymentOption[]): {
  kind: PaymentOptionKind;
  source: PaymentOption["source"];
  paramKey: string | null;
  hasAmount: boolean;
}[] {
  return options.map((option) => ({
    kind: option.kind,
    source: option.source,
    paramKey: option.paramKey ?? null,
    hasAmount: option.amount != null,
  }));
}

function logParseResult(
  stage: string,
  result: ParsedPaymentInput,
): ParsedPaymentInput {
  logger.debug("parse.paymentInput.result", {
    stage,
    rawLength: result.raw.length,
    normalizedLength: result.normalized.length,
    type: result.type,
    container: result.container,
    optionCount: result.options.length,
    options: summarizeOptions(result.options),
    warningCount: result.warnings.length,
    errorCount: result.errors.length,
    warnings: result.warnings,
    errors: result.errors,
    bip321ParamKeys: result.bip321
      ? Object.keys(result.bip321.params)
      : undefined,
    unsupportedParamKeyCount: result.bip321?.unsupportedParamKeys.length,
    unsupportedRequiredParamKeyCount:
      result.bip321?.unsupportedRequiredParamKeys.length,
    hasMintUrl: !!result.mintUrl,
    hasNpub: !!result.npub,
  });
  return result;
}

function firstOrNull(values?: string[]): string | null {
  return values && values.length > 0 ? values[0] : null;
}

function looksLikeBitcoinAddress(value: string): boolean {
  const candidate = value.trim();
  if (!candidate) return false;

  // Lightweight shape guard only. Full script/address validation belongs to
  // the wallet backend; here we just avoid treating arbitrary short paths in
  // bitcoin: URIs as actionable onchain addresses.
  if (/^(bc|tb|bcrt)1[ac-hj-np-z02-9]{11,87}$/i.test(candidate)) return true;
  return /^[123mn2][1-9A-HJ-NP-Za-km-z]{25,62}$/.test(candidate);
}

function looksLikeBip321OnchainParamValue(
  paramKey: string,
  value: string,
): boolean {
  const candidate = value.trim();
  if (!candidate) return false;

  // BIP321 says bech32/bech32m address instructions should use their HRP as
  // the query key, e.g. `bc=bc1...` or `tb=tb1...`.
  if (ONCHAIN_ADDRESS_PARAM_KEYS.has(paramKey)) {
    return (
      candidate.toLowerCase().startsWith(`${paramKey}1`) &&
      looksLikeBitcoinAddress(candidate)
    );
  }

  // BIP351 private payment addresses and BIP352 silent payment addresses are
  // onchain payment instructions. We only shape-detect them here; the current
  // wallet disables outbound onchain payment later in intent/annotation.
  if (paramKey === "pay") return /^pay1/i.test(candidate);
  if (paramKey === "sp") return /^sp1/i.test(candidate);
  return false;
}

function parseBtcAmountToSats(amountBtc: string | null): number | null {
  if (!amountBtc) return null;
  const trimmed = amountBtc.trim();
  if (!/^\d+(\.\d{1,8})?$/.test(trimmed)) return null;

  const [wholePart, fractionalPart = ""] = trimmed.split(".");
  const wholeSats = Number(wholePart) * 100_000_000;
  const fractionalSats = Number(fractionalPart.padEnd(8, "0"));
  const sats = wholeSats + fractionalSats;

  if (!Number.isSafeInteger(sats)) return null;
  return sats;
}

// ---------------------------------------------------------------------------
// Extract supported options from a single value
// ---------------------------------------------------------------------------

function extractOptions(
  input: string,
  source: "standalone" | "bip321",
  detectors: Detectors,
  paramKey: string | null = null,
): PaymentOption[] {
  const raw = sanitizeInput(input);
  if (!raw) return [];

  const seen = new Set<string>();
  const options: PaymentOption[] = [];
  const variants = [...inputVariants(raw)];

  for (const variant of variants) {
    const cashuCandidate = stripCashuPrefixes(variant);

    if (cashuCandidate && detectors.isValidEcashToken(cashuCandidate)) {
      pushOption(
        options,
        { kind: "ecashToken", value: cashuCandidate, source, paramKey },
        seen,
      );
    }

    if (cashuCandidate && detectors.isPaymentRequest(cashuCandidate)) {
      pushOption(
        options,
        { kind: "paymentRequest", value: cashuCandidate, source, paramKey },
        seen,
      );
    }

    const lightningCandidate = stripLightningPrefixes(variant);

    if (
      lightningCandidate &&
      detectors.isLightningInvoice(lightningCandidate)
    ) {
      pushOption(
        options,
        {
          kind: "lightningInvoice",
          value: lightningCandidate,
          amount: detectors.getLightningAmount(lightningCandidate),
          source,
          paramKey,
        },
        seen,
      );
      continue;
    }

    if (
      lightningCandidate &&
      detectors.isLightningAddress(lightningCandidate)
    ) {
      pushOption(
        options,
        {
          kind: "lightningAddress",
          value: lightningCandidate,
          source,
          paramKey,
        },
        seen,
      );
      continue;
    }

    if (lightningCandidate && detectors.isLnurlp(lightningCandidate)) {
      pushOption(
        options,
        { kind: "lnurlp", value: lightningCandidate, source, paramKey },
        seen,
      );
    }
  }

  const sorted = sortOptions(options);
  logger.debug("parse.extractOptions.result", {
    source,
    paramKey,
    inputLength: raw.length,
    variantCount: variants.length,
    optionCount: sorted.length,
    options: summarizeOptions(sorted),
  });
  return sorted;
}

// ---------------------------------------------------------------------------
// BIP-321 container parser
// ---------------------------------------------------------------------------

/**
 * Returns true if the input is a BIP321 bitcoin: URI.
 */
export function isBip321(input: string): boolean {
  return sanitizeInput(input).toLowerCase().startsWith("bitcoin:");
}

function parseBip321Container(input: string): Bip321Container | null {
  const trimmed = sanitizeInput(input);
  if (!trimmed.toLowerCase().startsWith("bitcoin:")) return null;

  let address: string | null = null;
  let params: Record<string, string[]> = {};

  try {
    const url = new URL(trimmed.replace(/^bitcoin:/i, "bitcoin://x/"));
    const path = url.pathname.replace(/^\/+/, "");
    address = path && path !== "x" ? path : null;

    for (const [rawKey, value] of url.searchParams.entries()) {
      const key = rawKey.toLowerCase();
      if (!params[key]) params[key] = [];
      params[key].push(value);
    }
  } catch {
    logger.debug("parse.bip321.fallbackParser", {
      inputLength: trimmed.length,
    });
    const [beforeQuery, query = ""] = trimmed.split("?");
    address = beforeQuery.replace(/^bitcoin:/i, "").trim() || null;

    for (const pair of query.split("&")) {
      if (!pair) continue;
      const [rawKey = "", rawValue = ""] = pair.split("=");
      const key = safeDecodeURIComponent(rawKey).toLowerCase();
      const value = safeDecodeURIComponent(rawValue);
      if (!key) continue;
      if (!params[key]) params[key] = [];
      params[key].push(value);
    }
  }

  const unsupportedParamKeys = Object.keys(params).filter(
    (key) => !KNOWN_BIP321_KEYS.has(key),
  );
  const unsupportedRequiredParamKeys = Object.keys(params).filter(
    (key) =>
      (key.startsWith("req-") && !KNOWN_BIP321_KEYS.has(key)) ||
      UNSUPPORTED_REQUIRED_BIP321_KEYS.has(key),
  );

  return {
    address,
    amountBtc: firstOrNull(params.amount),
    label: firstOrNull(params.label),
    message: firstOrNull(params.message),
    params,
    unsupportedParamKeys,
    unsupportedRequiredParamKeys,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function parsePaymentInput(
  rawInput: string,
  detectors: Detectors,
): ParsedPaymentInput {
  const normalized = sanitizeInput(rawInput);
  const warnings: string[] = [];
  const errors: string[] = [];

  logger.debug("parse.paymentInput.start", {
    rawLength: rawInput.length,
    normalizedLength: normalized.length,
    isBip321: normalized.toLowerCase().startsWith("bitcoin:"),
    isUr: normalized.toLowerCase().startsWith("ur:"),
  });

  if (!normalized) {
    return logParseResult("empty", {
      raw: rawInput,
      normalized,
      type: "unknown",
      container: null,
      options: [],
      warnings,
      errors: ["Empty input"],
    });
  }

  // UR animated QR fragments — signal to the caller, don't parse further
  if (normalized.toLowerCase().startsWith("ur:")) {
    return logParseResult("ur_fragment", {
      raw: rawInput,
      normalized,
      type: "ur",
      container: null,
      options: [],
      warnings,
      errors,
    });
  }

  // BIP-321 container
  const bip321 = parseBip321Container(normalized);
  if (bip321) {
    const seen = new Set<string>();
    const options: PaymentOption[] = [];
    const onchainAmount = parseBtcAmountToSats(bip321.amountBtc);

    if (bip321.address && looksLikeBitcoinAddress(bip321.address)) {
      pushOption(
        options,
        {
          kind: "onchainAddress",
          value: bip321.address,
          amount: onchainAmount,
          source: "bip321",
          paramKey: null,
        },
        seen,
      );

      for (const opt of extractOptions(bip321.address, "bip321", detectors)) {
        pushOption(options, opt, seen);
      }
    }

    for (const [paramKey, values] of Object.entries(bip321.params)) {
      for (const value of values) {
        if (
          (ONCHAIN_ADDRESS_PARAM_KEYS.has(paramKey) ||
            ONCHAIN_INSTRUCTION_PARAM_KEYS.has(paramKey)) &&
          looksLikeBip321OnchainParamValue(paramKey, value)
        ) {
          pushOption(
            options,
            {
              kind: "onchainAddress",
              value: value.trim(),
              amount: onchainAmount,
              source: "bip321",
              paramKey,
            },
            seen,
          );
        }

        for (const opt of extractOptions(
          value,
          "bip321",
          detectors,
          paramKey,
        )) {
          pushOption(options, opt, seen);
        }
      }
    }

    if (bip321.unsupportedParamKeys.length > 0) {
      logger.info("parse.bip321.unsupportedParams", {
        keys: bip321.unsupportedParamKeys,
        count: bip321.unsupportedParamKeys.length,
      });
      warnings.push(
        `Ignored unsupported bitcoin params: ${bip321.unsupportedParamKeys.join(", ")}`,
      );
    }

    if (bip321.unsupportedRequiredParamKeys.length > 0) {
      logger.warn("parse.bip321.unsupportedRequiredParams", {
        keys: bip321.unsupportedRequiredParamKeys,
        count: bip321.unsupportedRequiredParamKeys.length,
      });
      errors.push(
        `Unsupported required bitcoin params: ${bip321.unsupportedRequiredParamKeys.join(", ")}`,
      );
      options.length = 0;
    }

    if (bip321.amountBtc && onchainAmount == null) {
      logger.warn("parse.bip321.invalidAmount", {
        amountLength: bip321.amountBtc.length,
      });
      warnings.push("Ignored invalid bitcoin amount");
    }

    const result: ParsedPaymentInput = {
      raw: rawInput,
      normalized,
      type: options.length > 0 ? "payment" : "bip321",
      container: "bip321",
      options: sortOptions(options),
      bip321,
      warnings,
      errors,
    };
    return logParseResult("bip321", result);
  }

  // Nostr npub. Keep this before raw onchain detection because npubs are
  // bech32-shaped and can otherwise look like loose testnet base58 addresses.
  const npub = detectors.parseNpub(normalized);
  if (npub) {
    return logParseResult("npub", {
      raw: rawInput,
      normalized,
      type: "npub",
      container: null,
      options: [],
      npub,
      warnings,
      errors,
    });
  }

  if (looksLikeBitcoinAddress(normalized)) {
    return logParseResult("standalone_onchain", {
      raw: rawInput,
      normalized,
      type: "payment",
      container: "standalone",
      options: [
        {
          kind: "onchainAddress",
          value: normalized,
          amount: null,
          source: "standalone",
          paramKey: null,
        },
      ],
      warnings,
      errors,
    });
  }

  // Standalone supported payment types
  const standaloneOptions = extractOptions(normalized, "standalone", detectors);
  if (standaloneOptions.length > 0) {
    const result: ParsedPaymentInput = {
      raw: rawInput,
      normalized,
      type: "payment",
      container: "standalone",
      options: standaloneOptions,
      warnings,
      errors,
    };
    return logParseResult("standalone_payment", result);
  }

  // Mint URL — Cashu mint traffic carries blinded messages, signatures, and
  // melt quotes; on plain HTTP a MitM can swap-race or return malformed Bs
  // that break recovery. Reject `http://` outright unless the host is a
  // `.onion` (where TLS would fail anyway and the transport is already
  // anonymised). The error code is opaque to the parser; the wallet's trust
  // flow is responsible for surfacing it to the user.
  const httpsMatch = /^https:\/\//i.test(normalized);
  const httpMatch = /^http:\/\//i.test(normalized);
  if (httpsMatch || httpMatch) {
    if (httpMatch) {
      let host = "";
      try {
        host = new URL(normalized).hostname.toLowerCase();
      } catch {
        // fall through to unknown
      }
      if (!host.endsWith(".onion")) {
        logger.warn("parse.mintUrl.insecureHttp", { host });
        return logParseResult("mint_insecure_http", {
          raw: rawInput,
          normalized,
          type: "unknown",
          container: null,
          options: [],
          warnings,
          errors: [...errors, "MINT_INSECURE_HTTP"],
        });
      }
    }
    return logParseResult("mint_url", {
      raw: rawInput,
      normalized,
      type: "mintUrl",
      container: null,
      options: [],
      mintUrl: normalized,
      warnings,
      errors,
    });
  }

  const result: ParsedPaymentInput = {
    raw: rawInput,
    normalized,
    type: "unknown",
    container: null,
    options: [],
    warnings,
    errors,
  };
  return logParseResult("unknown", result);
}
