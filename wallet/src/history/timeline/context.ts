// ---------------------------------------------------------------------------
// Timeline context resolution + entry helpers
// ---------------------------------------------------------------------------
//
// Helpers moved verbatim from the old history/timeline.ts switch — every
// logging event keeps its name, fields, and firing conditions (log-doctor
// depends on the taxonomy). `createTimelineContext` resolves the raw build
// input into the TimelineContext the flow definitions read, including the
// flow-variant dispatch that used to be the switch's branching.

import { MintQuoteState, type MeltQuoteBolt11Response } from "@cashu/cashu-ts";
import type { HistoryEntry } from "@cashu/coco-core";
import { decode } from "@gandlaf21/bolt11-decode";

import { defaultDetectors } from "../../detectors";
import { looksLikeBitcoinAddress, parsePaymentInput } from "../../parse";
import {
  createPaymentCopyGroups,
  createPaymentCopyResolver,
  type PaymentCopyResolver,
} from "../../copy";
import { logger } from "../../logger";
import { normalizeTimelineMintState, normalizeTimelineMeltState } from "../states";
import type {
  BuildTimelineInput,
  OnchainConfirmationProgress,
  TimelineContext,
  TimelineFlowVariant,
  TimelineStepType,
} from "./types";

export const EXPIRED_STATE = "expired";
export const FAILED_STATE = "failed";

export type EntryRecord = Record<string, unknown>;
type AmountLike = number | bigint | string | { toNumber(): number };
type AmountValue = AmountLike | null | undefined;

export const DEFAULT_PAYMENT_COPY = createPaymentCopyResolver();

function amountToNumber(value: AmountValue): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return value.toNumber();
}

function getBip321OnchainAddress(value: string): string | null {
  if (!value.trim().toLowerCase().startsWith("bitcoin:")) return null;

  try {
    const parsed = parsePaymentInput(value, defaultDetectors);
    const address =
      parsed.options.find((option) => option.kind === "onchainAddress")
        ?.value ?? null;
    logger.debug("history.timeline.bip321.parse", {
      inputLength: value.length,
      optionCount: parsed.options.length,
      hasOnchainAddress: !!address,
      addressLength: address?.length ?? null,
    });
    return address;
  } catch {
    logger.warn("history.timeline.bip321.parseFailed", {
      inputLength: value.length,
    });
    return null;
  }
}

export function getHistoryEntryOnchainMintAddress(
  entry: HistoryEntry | null | undefined,
): string | null {
  if (!entry || entry.type !== "mint") {
    logger.debug("history.timeline.onchainMintAddress.result", {
      reason: !entry ? "missing-entry" : "wrong-type",
      type: entry?.type ?? null,
    });
    return null;
  }

  const metadata = (entry as EntryRecord).metadata;
  const meta =
    metadata && typeof metadata === "object"
      ? (metadata as EntryRecord)
      : undefined;
  const metadataAddress = meta?.onchainAddress;
  if (meta?.method === "onchain" && typeof metadataAddress === "string") {
    const address = metadataAddress.trim();
    if (address) {
      logger.debug("history.timeline.onchainMintAddress.result", {
        reason: "metadata",
        type: entry.type,
        state: String((entry as EntryRecord).state ?? ""),
        addressLength: address.length,
      });
      return address;
    }
  }

  const paymentRequest = (entry as EntryRecord).paymentRequest;
  if (typeof paymentRequest !== "string") {
    logger.debug("history.timeline.onchainMintAddress.result", {
      reason: "missing-payment-request",
      type: entry.type,
      state: String((entry as EntryRecord).state ?? ""),
    });
    return null;
  }
  const address = paymentRequest.trim();
  const bip321Address = getBip321OnchainAddress(address);
  if (bip321Address) {
    logger.debug("history.timeline.onchainMintAddress.result", {
      reason: "bip321",
      type: entry.type,
      state: String((entry as EntryRecord).state ?? ""),
      paymentRequestLength: address.length,
      addressLength: bip321Address.length,
    });
    return bip321Address;
  }
  const directAddress = looksLikeBitcoinAddress(address) ? address : null;
  logger.debug("history.timeline.onchainMintAddress.result", {
    reason: directAddress ? "direct-address" : "not-onchain",
    type: entry.type,
    state: String((entry as EntryRecord).state ?? ""),
    paymentRequestLength: address.length,
    addressLength: directAddress?.length ?? null,
  });
  return directAddress;
}

/** The recipient bitcoin address of an onchain MELT (send) history entry, or
 *  null. Fresh/synthetic entries carry it in `metadata` (method 'onchain' +
 *  onchainAddress/meltTarget); persisted coco melt rows carry no metadata, so
 *  callers pass `onchainConfirmationProgress` to signal onchain-ness instead. */
export function getHistoryEntryOnchainMeltAddress(
  entry: HistoryEntry | null | undefined,
): string | null {
  if (!entry || entry.type !== "melt") return null;
  const metadata = (entry as EntryRecord).metadata;
  const meta =
    metadata && typeof metadata === "object"
      ? (metadata as EntryRecord)
      : undefined;
  if (meta?.method !== "onchain") return null;
  const target = meta.onchainAddress ?? meta.meltTarget ?? meta.destination;
  const address = typeof target === "string" ? target.trim() : "";
  return address || null;
}

export function getOnchainConfirmationInfo(
  progress: OnchainConfirmationProgress,
  paymentCopy: PaymentCopyResolver,
): string {
  if (progress.hasUnconfirmedPayment && progress.currentConfirmations == null) {
    logger.debug("history.timeline.onchainConfirmationInfo.result", {
      reason: "waiting-first-confirmation",
      currentConfirmations: progress.currentConfirmations,
      requiredConfirmations: progress.requiredConfirmations,
      isSatisfied: progress.isSatisfied,
    });
    return paymentCopy.text("timeline.onchain.waitingFirstConfirmation");
  }

  if (progress.currentConfirmations == null) {
    logger.debug("history.timeline.onchainConfirmationInfo.result", {
      reason: "confirmed-no-count",
      currentConfirmations: progress.currentConfirmations,
      requiredConfirmations: progress.requiredConfirmations,
      isSatisfied: progress.isSatisfied,
    });
    return paymentCopy.text("timeline.onchain.paymentConfirmed");
  }

  logger.debug("history.timeline.onchainConfirmationInfo.result", {
    reason: "counted-confirmations",
    currentConfirmations: progress.currentConfirmations,
    requiredConfirmations: progress.requiredConfirmations,
    isSatisfied: progress.isSatisfied,
  });
  return paymentCopy.text("timeline.onchain.confirmations", {
    current: progress.currentConfirmations,
    required: progress.requiredConfirmations,
  });
}

export function onchainPaidStepType(
  progress: OnchainConfirmationProgress | null | undefined,
): TimelineStepType {
  // Once the first confirmation lands the payment has effectively been
  // received, so promote the step from 'next-pending' to 'current'. That lets
  // the connector line from "Waiting for payment" fill into "Payment received"
  // even though issuance is still pending the remaining confirmations.
  const stepType =
    progress?.currentConfirmations != null && progress.currentConfirmations >= 1
      ? "current"
      : "next-pending";
  logger.debug("history.timeline.onchainPaidStepType.result", {
    stepType,
    currentConfirmations: progress?.currentConfirmations ?? null,
    requiredConfirmations: progress?.requiredConfirmations ?? null,
    isSatisfied: progress?.isSatisfied ?? null,
  });
  return stepType;
}

export function mintHistoryEntryExpired(
  historyEntry: Extract<HistoryEntry, { type: "mint" }>,
): boolean {
  try {
    if (!historyEntry.paymentRequest) {
      logger.debug("history.timeline.mintExpired.result", {
        reason: "missing-payment-request",
        expired: false,
      });
      return false;
    }
    const paymentRequest = decode(historyEntry.paymentRequest);
    const expiry = paymentRequest.expiry ?? 3600;
    const timestamp =
      paymentRequest.sections.find((section) => section.name === "timestamp")
        ?.value ?? 0;
    const expiryTime = (timestamp + expiry) * 1000;

    const expired = Date.now() > expiryTime;
    logger.debug("history.timeline.mintExpired.result", {
      reason: "decoded",
      expired,
      expiry,
      paymentRequestLength: historyEntry.paymentRequest.length,
    });
    return expired;
  } catch {
    logger.warn("history.timeline.mintExpired.decodeFailed", {
      paymentRequestLength: historyEntry.paymentRequest?.length ?? 0,
    });
    return false;
  }
}

export function meltQuoteExpired(
  meltQuote: MeltQuoteBolt11Response,
  currentTimeMs?: number,
): boolean {
  if (!meltQuote.expiry) {
    logger.debug("history.timeline.meltExpired.result", {
      reason: "missing-expiry",
      expired: false,
    });
    return false;
  }
  const nowSec = Math.floor((currentTimeMs ?? Date.now()) / 1000);
  const expired = nowSec > meltQuote.expiry;
  logger.debug("history.timeline.meltExpired.result", {
    reason: "expiry-compared",
    expired,
    expiry: meltQuote.expiry,
  });
  return expired;
}

type MintTimelineState = MintQuoteState | typeof FAILED_STATE | string;

export function getMintTimelineState(
  historyEntry: HistoryEntry,
): MintTimelineState {
  if (historyEntry.type !== "mint") return String(historyEntry.state);
  const remoteState =
    "remoteState" in historyEntry ? historyEntry.remoteState : undefined;
  // Aliasing + remoteState precedence live in history/states.ts (one owner).
  return normalizeTimelineMintState(String(historyEntry.state), remoteState);
}

/** Resolve the raw build input into the context the flow definitions read.
 *  Helper evaluation order (mint state → onchain address) matches the old
 *  switch so the debug-log sequence is unchanged. */
export function createTimelineContext(input: BuildTimelineInput): TimelineContext {
  const entry = input.historyEntry;
  const paymentCopy = input.paymentCopy ?? DEFAULT_PAYMENT_COPY;
  // Resolve copy groups FIRST — the old switch did this at the top of
  // buildTimelineItems, so the copy.groups.* debug logs precede the
  // state-resolution logs.
  const copy = createPaymentCopyGroups(paymentCopy);
  const state = String((entry as EntryRecord).state ?? "");

  let variant: TimelineFlowVariant = "unknown";
  let mintState: string | null = null;
  let meltState: string | null = null;
  let prPendingFlag = false;

  switch (entry.type) {
    case "mint": {
      mintState = getMintTimelineState(entry);
      variant = getHistoryEntryOnchainMintAddress(entry)
        ? "onchain-mint"
        : "lightning-mint";
      break;
    }
    case "melt": {
      meltState = normalizeTimelineMeltState(state);
      // Onchain-ness is signalled by the entry metadata (fresh sends) or by the
      // caller passing a progress object (persisted rows on the send screen).
      variant =
        getHistoryEntryOnchainMeltAddress(entry) ||
        input.onchainConfirmationProgress
          ? "onchain-melt"
          : "lightning-melt";
      break;
    }
    case "send": {
      variant =
        input.tokenCreated !== undefined || input.nostrSent
          ? "payment-request-send"
          : "send";
      break;
    }
    case "receive": {
      // Incoming payment-request receive ("Fixed Amount → as Ecash"): detected
      // off the synthetic pending row's flag (paymentRequestPending) or a
      // claimed child receive's source.
      const meta = (entry as { metadata?: Record<string, string> }).metadata;
      prPendingFlag = meta?.paymentRequestPending === "1";
      variant =
        prPendingFlag || meta?.source === "payment-request"
          ? "payment-request-receive"
          : state === "executing"
            ? "receive-recovery"
            : "receive";
      break;
    }
    default:
      variant = "unknown";
  }

  return {
    entry,
    state,
    createdAt: entry.createdAt,
    amount: amountToNumber((entry as EntryRecord).amount as AmountValue),
    meltQuote: input.meltQuote,
    currentTime: input.currentTime,
    tokenCreated: input.tokenCreated,
    nostrSent: input.nostrSent,
    progress: input.onchainConfirmationProgress,
    onchainSettledInternally: input.onchainSettledInternally,
    paymentCopy,
    copy,
    variant,
    mintState,
    meltState,
    prPendingFlag,
  };
}
