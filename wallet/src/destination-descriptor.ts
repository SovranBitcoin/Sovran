// ---------------------------------------------------------------------------
// Destination Descriptor
//
// A pure, synchronous, framework-agnostic layer that turns a parsed Send-flow
// destination into a render-ready `DestinationDescriptor`: what kind it is, the
// statically-known amount, colada-owned action copy, a semantic icon token, the
// action to take, and (for payable identities) a recipient slot the app fills
// asynchronously.
//
// It composes the existing `resolveIntent` (the single source of truth for
// classification) and decorates the result — it never re-classifies and never
// does I/O. Two deliberate overrides of `resolveIntent`'s semantics for the Send
// context: a typed lightning address and an npub are treated as a payable
// *person* (`startContactSend`) rather than a melt / profile-view, because the
// app resolves the identity (NIP-05 / profile metadata) that colada won't.
// ---------------------------------------------------------------------------

import { createPaymentCopyResolver } from "./copy";
import type { PaymentCopyKey, PaymentCopyResolver } from "./copy";
import { decodeEcashTokenMetadata } from "./ecash";
import { resolveIntent } from "./intent";
import { logger } from "./logger";
import type {
  DestinationAmount,
  DestinationDescriptor,
  Detectors,
  ParsedPaymentInput,
  PaymentOption,
  PaymentRequestInfo,
  WalletContext,
} from "./types";

export interface DescribeDestinationOptions {
  /** Locale-bound copy resolver. Defaults to the `en` resolver. */
  copy?: PaymentCopyResolver;
}

/** Descriptor fields derived from a payable option, before `raw` is attached. */
type DescribedOption = Omit<DestinationDescriptor, "raw">;

/**
 * Resolve the action copy for an amount-bearing kind. Amount-bearing copy keys
 * embed "sats", so they apply only when the amount is denominated in `'sat'`;
 * otherwise fall back to the verb-only key (the structured `amount` still rides
 * on the descriptor for the app to format in its own unit).
 */
function amountLabel(
  copy: PaymentCopyResolver,
  amount: DestinationAmount | null,
  amountKey: PaymentCopyKey,
  bareKey: PaymentCopyKey,
): string {
  return amount && amount.unit === "sat"
    ? copy.text(amountKey, { amount: amount.value })
    : copy.text(bareKey);
}

function describePaymentOption(
  option: PaymentOption,
  detectors: Detectors,
  copy: PaymentCopyResolver,
  paymentRequestInfo?: PaymentRequestInfo,
): DescribedOption {
  switch (option.kind) {
    case "ecashToken": {
      const meta = decodeEcashTokenMetadata(option.value);
      const amount =
        meta && meta.amount > 0
          ? { value: meta.amount, unit: meta.unit }
          : null;
      return {
        kind: "ecash",
        label: amountLabel(
          copy,
          amount,
          "send.destination.redeemAmount",
          "send.destination.redeem",
        ),
        amount,
        icon: "ecash",
        action: "receiveToken",
        hasAlternatives: false,
      };
    }

    case "paymentRequest": {
      const info =
        paymentRequestInfo ?? detectors.getPaymentRequestInfo(option.value);
      const amount =
        info?.amount != null
          ? { value: info.amount, unit: info.unit }
          : null;
      return {
        kind: "paymentRequest",
        label: amountLabel(
          copy,
          amount,
          "send.destination.payAmount",
          "send.destination.payRequest",
        ),
        amount,
        icon: "paymentRequest",
        action: "sendPaymentRequest",
        hasAlternatives: false,
        ...(info?.lockP2pkPubkey
          ? {
              recipient: {
                ref: { type: "pubkey" as const, value: info.lockP2pkPubkey },
                pending: true,
              },
            }
          : {}),
      };
    }

    case "lightningInvoice": {
      const amount =
        option.amount != null ? { value: option.amount, unit: "sat" } : null;
      return {
        kind: "lightningInvoice",
        label: amountLabel(
          copy,
          amount,
          "send.destination.payAmount",
          "send.destination.payInvoice",
        ),
        amount,
        icon: "lightning",
        action: "meltInvoice",
        hasAlternatives: false,
      };
    }

    case "lightningAddress":
      // A typed lightning address is treated as a payable person (mirrors
      // selecting a contact); the app resolves NIP-05 → profile.
      return {
        kind: "person",
        label: copy.text("send.destination.pay"),
        amount: null,
        icon: "person",
        action: "startContactSend",
        hasAlternatives: false,
        recipient: {
          ref: { type: "lightningAddress", value: option.value },
          pending: true,
        },
      };

    case "lnurlp":
      // A bare lnurlp endpoint has no identity to resolve — pay it via Lightning.
      return {
        kind: "lightningAddress",
        label: copy.text("send.destination.pay"),
        amount: null,
        icon: "lightning",
        action: "meltLnurl",
        hasAlternatives: false,
      };

    case "onchainAddress": {
      const amount =
        option.amount != null ? { value: option.amount, unit: "sat" } : null;
      return {
        kind: "onchain",
        label: amountLabel(
          copy,
          amount,
          "send.destination.sendAmount",
          "send.destination.sendOnchain",
        ),
        amount,
        icon: "onchain",
        action: "meltOnchain",
        hasAlternatives: false,
      };
    }
  }
}

/**
 * Describe a parsed Send-flow destination as a render-ready descriptor.
 * Synchronous, never throws, no I/O.
 */
export function describeDestination(
  parsed: ParsedPaymentInput,
  detectors: Detectors,
  ctx?: WalletContext,
  options?: DescribeDestinationOptions,
): DestinationDescriptor {
  const copy = options?.copy ?? createPaymentCopyResolver();
  const raw = parsed.raw;
  const intent = resolveIntent(parsed, detectors, ctx);

  const unsupported = (label: string): DestinationDescriptor => ({
    kind: "unsupported",
    label,
    amount: null,
    icon: "unknown",
    action: "none",
    hasAlternatives: false,
    raw,
  });

  let described: DestinationDescriptor;
  switch (intent.type) {
    case "receiveToken":
    case "meltLightningInvoice":
    case "meltLightningAddress":
    case "meltLnurlp":
    case "meltOnchainAddress":
      described = { ...describePaymentOption(intent.option, detectors, copy), raw };
      break;

    case "sendPaymentRequest":
      described = {
        ...describePaymentOption(intent.option, detectors, copy, intent.info),
        raw,
      };
      break;

    case "openMint":
      described = {
        kind: "mint",
        label: copy.text("send.destination.openMint"),
        amount: null,
        icon: "mint",
        action: "openMint",
        hasAlternatives: false,
        raw,
      };
      break;

    case "openProfile":
      described = {
        kind: "person",
        label: copy.text("send.destination.pay"),
        amount: null,
        icon: "person",
        action: "startContactSend",
        hasAlternatives: false,
        recipient: { ref: { type: "npub", value: intent.npub }, pending: true },
        raw,
      };
      break;

    case "chooseOption": {
      // Multi-option input (e.g. BIP-321). Show the primary option (parse sorts
      // by priority) and defer to the existing chooser on tap.
      const primary = intent.options[0]?.option;
      described = primary
        ? {
            ...describePaymentOption(primary, detectors, copy),
            action: "chooseOption",
            hasAlternatives: true,
            raw,
          }
        : unsupported(copy.text("send.destination.unsupported"));
      break;
    }

    case "ignore":
      // Empty input → empty label so the app can hide the row entirely.
      described = unsupported(
        parsed.raw.trim() === ""
          ? ""
          : copy.text("send.destination.unsupported"),
      );
      break;
  }

  logger.debug("destination.describe.result", {
    kind: described.kind,
    action: described.action,
    hasAmount: described.amount != null,
    hasRecipient: !!described.recipient,
    hasAlternatives: described.hasAlternatives,
  });
  return described;
}
