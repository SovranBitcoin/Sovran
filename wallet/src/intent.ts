// ---------------------------------------------------------------------------
// Intent Resolution
//
// Maps a ParsedPaymentInput to a ResolvedIntent. When a single payment
// option exists, resolves directly. When multiple options exist, annotates
// them and returns a chooseOption intent. Non-payment inputs (mint URL,
// npub) resolve to their own intents.
// ---------------------------------------------------------------------------

import { annotateOptions } from "./annotate";
import { logger } from "./logger";
import type {
  ParsedPaymentInput,
  PaymentOption,
  PaymentOptionKind,
  Detectors,
  WalletContext,
  ResolvedIntent,
  AnnotatedOption,
} from "./types";

// ---------------------------------------------------------------------------
// Single-option intent mapping
// ---------------------------------------------------------------------------

function summarizeOption(option: PaymentOption): {
  kind: PaymentOptionKind;
  source: PaymentOption["source"];
  paramKey: string | null;
  hasAmount: boolean;
} {
  return {
    kind: option.kind,
    source: option.source,
    paramKey: option.paramKey ?? null,
    hasAmount: option.amount != null,
  };
}

function summarizeIntent(intent: ResolvedIntent): Record<string, unknown> {
  switch (intent.type) {
    case "receiveToken":
    case "meltLightningInvoice":
    case "meltBolt12Offer":
    case "meltLightningAddress":
    case "meltLnurlp":
    case "meltOnchainAddress":
      return { option: summarizeOption(intent.option) };
    case "sendPaymentRequest":
      return {
        option: summarizeOption(intent.option),
        mintCount: intent.info.mints.length,
        hasAmount: intent.info.amount != null,
        unit: intent.info.unit,
        transportTypes:
          intent.info.transports?.map((transport) => transport.type) ?? [],
      };
    case "chooseOption":
      return {
        optionCount: intent.options.length,
        options: intent.options.map((option) => ({
          ...summarizeOption(option.option),
          status: option.status,
          reasonCode: option.reason?.code,
        })),
      };
    case "openMint":
      return { urlLength: intent.url.length };
    case "openProfile":
      return { npubLength: intent.npub.length };
    case "ignore":
      return { reasonCode: intent.reason.code };
  }
}

function resolveForSingleOption(
  option: PaymentOption,
  detectors: Detectors,
): ResolvedIntent {
  logger.debug("intent.singleOption.start", summarizeOption(option));
  switch (option.kind) {
    case "ecashToken":
      return { type: "receiveToken", option };

    case "paymentRequest": {
      const info = detectors.getPaymentRequestInfo(option.value);
      logger.debug("intent.singleOption.paymentRequest.info", {
        decoded: !!info,
        mintCount: info?.mints.length ?? 0,
        hasAmount: info?.amount != null,
        unit: info?.unit ?? "sat",
        transportTypes:
          info?.transports?.map((transport) => transport.type) ?? [],
      });
      return {
        type: "sendPaymentRequest",
        option,
        info: info ?? { mints: [], amount: undefined, unit: "sat" },
      };
    }

    case "lightningInvoice":
      return { type: "meltLightningInvoice", option };

    case "bolt12Offer":
      return { type: "meltBolt12Offer", option };

    case "lightningAddress":
      return { type: "meltLightningAddress", option };

    case "lnurlp":
      return { type: "meltLnurlp", option };

    case "onchainAddress":
      return { type: "meltOnchainAddress", option };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function resolveIntent(
  parsed: ParsedPaymentInput,
  detectors: Detectors,
  ctx?: WalletContext,
): ResolvedIntent {
  logger.debug("intent.resolve.start", {
    parsedType: parsed.type,
    container: parsed.container,
    optionCount: parsed.options.length,
    optionKinds: parsed.options.map((option) => option.kind),
    warningCount: parsed.warnings.length,
    errorCount: parsed.errors.length,
    hasWalletContext: !!ctx,
  });

  if (parsed.errors.length > 0) {
    const intent: ResolvedIntent = {
      type: "ignore",
      reason: {
        code: "UNSUPPORTED_INPUT",
        message: parsed.errors[0],
      },
    };
    logger.warn("intent.resolve.ignoredForErrors", summarizeIntent(intent));
    return intent;
  }

  // Multiple options → chooseOption (annotated when wallet context is available)
  if (parsed.options.length > 1) {
    const annotated: AnnotatedOption[] = ctx
      ? annotateOptions(parsed.options, ctx, detectors)
      : parsed.options.map((option) => ({
          option,
          status: "available" as const,
          reason: null,
        }));

    const intent: ResolvedIntent = { type: "chooseOption", options: annotated };
    logger.info("intent.resolve.result", {
      intentType: intent.type,
      ...summarizeIntent(intent),
    });
    return intent;
  }

  // Single option → direct intent
  if (parsed.options.length === 1) {
    const intent = resolveForSingleOption(parsed.options[0], detectors);
    logger.info("intent.resolve.result", {
      intentType: intent.type,
      ...summarizeIntent(intent),
    });
    return intent;
  }

  // Non-payment intents
  if (parsed.type === "mintUrl" && parsed.mintUrl) {
    const intent: ResolvedIntent = { type: "openMint", url: parsed.mintUrl };
    logger.info("intent.resolve.result", {
      intentType: intent.type,
      ...summarizeIntent(intent),
    });
    return intent;
  }

  if (parsed.type === "npub" && parsed.npub) {
    const intent: ResolvedIntent = { type: "openProfile", npub: parsed.npub };
    logger.info("intent.resolve.result", {
      intentType: intent.type,
      ...summarizeIntent(intent),
    });
    return intent;
  }

  // BIP-321 with no supported option
  if (parsed.type === "bip321") {
    const intent: ResolvedIntent = {
      type: "ignore",
      reason: {
        code: "UNSUPPORTED_INPUT",
        message: "Bitcoin URI contained no supported payment option",
      },
    };
    logger.warn("intent.resolve.result", {
      intentType: intent.type,
      ...summarizeIntent(intent),
    });
    return intent;
  }

  const intent: ResolvedIntent = {
    type: "ignore",
    reason: { code: "UNSUPPORTED_INPUT", message: "Unsupported input" },
  };
  logger.warn("intent.resolve.result", {
    intentType: intent.type,
    ...summarizeIntent(intent),
  });
  return intent;
}
