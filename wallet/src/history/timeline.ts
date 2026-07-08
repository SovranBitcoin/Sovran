import {
  MintQuoteState,
  MeltQuoteState,
  type MeltQuoteBolt11Response,
} from "@cashu/cashu-ts";
import type { HistoryEntry, MintHistoryEntry } from "@cashu/coco-core";
import { decode } from "@gandlaf21/bolt11-decode";

import { defaultDetectors } from "../detectors";
import { parsePaymentInput } from "../parse";
import {
  createPaymentCopyGroups,
  createPaymentCopyResolver,
  type PaymentCopyResolver,
} from "../copy";
import { logger } from "../logger";

const EXPIRED_STATE = "expired";
const FAILED_STATE = "failed";

type EntryRecord = Record<string, unknown>;
type AmountLike = number | bigint | string | { toNumber(): number };
type AmountValue = AmountLike | null | undefined;

export interface OnchainConfirmationProgress {
  hasPayment: boolean;
  hasUnconfirmedPayment: boolean;
  receivedSats: number;
  currentConfirmations: number | null;
  requiredConfirmations: number;
  isSatisfied: boolean;
}

export type TimelineStepType =
  | "complete"
  | "current"
  | "waiting"
  | "next-pending"
  | "future-small"
  | "expired"
  | "rolled-back"
  | "already-spent"
  | "success";

export interface TimelineItem {
  state: string;
  displayLabel: string;
  stepType: TimelineStepType;
  timestamp?: number;
  info?: string;
}

export interface BuildTimelineInput {
  historyEntry: HistoryEntry;
  meltQuote?: MeltQuoteBolt11Response;
  currentTime: number;
  tokenCreated?: boolean;
  nostrSent?: boolean;
  onchainConfirmationProgress?: OnchainConfirmationProgress | null;
  paymentCopy?: PaymentCopyResolver;
}

const DEFAULT_PAYMENT_COPY = createPaymentCopyResolver();

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

function looksLikeBitcoinAddress(value: string): boolean {
  const candidate = value.trim();
  if (!candidate) return false;

  if (/^(bc|tb|bcrt)1[ac-hj-np-z02-9]{11,87}$/i.test(candidate)) return true;
  return /^[123mn2][1-9A-HJ-NP-Za-km-z]{25,62}$/.test(candidate);
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

function getOnchainConfirmationInfo(
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

function onchainPaidStepType(
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

function meltQuoteExpired(
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

function isMintQuoteState(value: unknown): value is MintQuoteState {
  return (
    value === MintQuoteState.UNPAID ||
    value === MintQuoteState.PAID ||
    value === MintQuoteState.ISSUED
  );
}

function getMintTimelineState(historyEntry: HistoryEntry): MintTimelineState {
  if (historyEntry.type !== "mint") return String(historyEntry.state);

  const rawState = String(historyEntry.state);
  if (rawState === "finalized") {
    logger.debug("history.timeline.mintState.result", {
      rawState,
      remoteState:
        "remoteState" in historyEntry ? historyEntry.remoteState : null,
      timelineState: MintQuoteState.ISSUED,
      reason: "finalized-alias",
    });
    return MintQuoteState.ISSUED;
  }
  if (rawState === "executing") {
    logger.debug("history.timeline.mintState.result", {
      rawState,
      remoteState:
        "remoteState" in historyEntry ? historyEntry.remoteState : null,
      timelineState: MintQuoteState.PAID,
      reason: "executing-alias",
    });
    return MintQuoteState.PAID;
  }
  if (rawState === "failed") {
    logger.debug("history.timeline.mintState.result", {
      rawState,
      remoteState:
        "remoteState" in historyEntry ? historyEntry.remoteState : null,
      timelineState: FAILED_STATE,
      reason: "failed-alias",
    });
    return FAILED_STATE;
  }

  const remoteState =
    "remoteState" in historyEntry ? historyEntry.remoteState : undefined;
  if (isMintQuoteState(remoteState)) {
    logger.debug("history.timeline.mintState.result", {
      rawState,
      remoteState,
      timelineState: remoteState,
      reason: "remote-state",
    });
    return remoteState;
  }
  if (rawState === "pending") {
    logger.debug("history.timeline.mintState.result", {
      rawState,
      remoteState: remoteState ?? null,
      timelineState: MintQuoteState.UNPAID,
      reason: "pending-alias",
    });
    return MintQuoteState.UNPAID;
  }
  if (isMintQuoteState(rawState)) {
    logger.debug("history.timeline.mintState.result", {
      rawState,
      remoteState: remoteState ?? null,
      timelineState: rawState,
      reason: "native-state",
    });
    return rawState;
  }
  logger.debug("history.timeline.mintState.result", {
    rawState,
    remoteState: remoteState ?? null,
    timelineState: rawState,
    reason: "unknown-state",
  });
  return rawState;
}

function buildTimelineItems({
  historyEntry,
  meltQuote,
  currentTime,
  tokenCreated,
  nostrSent,
  onchainConfirmationProgress,
  paymentCopy = DEFAULT_PAYMENT_COPY,
}: BuildTimelineInput): TimelineItem[] {
  const {
    MINT_COPY,
    MELT_COPY,
    SEND_COPY,
    PAYMENT_REQUEST_COPY,
    RECEIVE_COPY,
  } = createPaymentCopyGroups(paymentCopy);

  switch (historyEntry.type) {
    case "mint": {
      const mintState = getMintTimelineState(historyEntry);
      const isOnchainMint = !!getHistoryEntryOnchainMintAddress(historyEntry);
      const waitingInfo = isOnchainMint
        ? MINT_COPY.UNPAID.onchainInfo
        : MINT_COPY.UNPAID.info;
      const isExpired =
        !isOnchainMint &&
        mintState === MintQuoteState.UNPAID &&
        mintHistoryEntryExpired(historyEntry);

      if (isExpired) {
        return [
          {
            state: MintQuoteState.UNPAID,
            displayLabel: MINT_COPY.UNPAID.label,
            stepType: "complete",
            timestamp: historyEntry.createdAt,
          },
          {
            state: EXPIRED_STATE,
            displayLabel: MINT_COPY.expired.label,
            stepType: "expired",
            info: MINT_COPY.expired.info,
          },
        ];
      }

      if (mintState === FAILED_STATE) {
        return [
          {
            state: MintQuoteState.UNPAID,
            displayLabel: MINT_COPY.UNPAID.label,
            stepType: "complete",
            timestamp: historyEntry.createdAt,
          },
          {
            state: FAILED_STATE,
            displayLabel: MINT_COPY.failed.label,
            stepType: "expired",
            info:
              (historyEntry as MintHistoryEntry & { error?: string }).error ??
              MINT_COPY.failed.info,
          },
        ];
      }

      switch (mintState) {
        case MintQuoteState.UNPAID:
          if (isOnchainMint && onchainConfirmationProgress?.hasPayment) {
            // The deposit is visible on-chain (our own explorer), but the mint
            // has NOT credited the quote yet (state still UNPAID). Do not claim
            // "Payment received" here — that milestone is the mint marking the
            // quote PAID. Until then the middle step reports the on-chain
            // confirmation phase and, once confirmations are satisfied, that
            // we're waiting on the mint to credit.
            const satisfied = onchainConfirmationProgress.isSatisfied;
            return [
              {
                state: MintQuoteState.UNPAID,
                displayLabel: MINT_COPY.UNPAID.label,
                stepType: "complete",
                timestamp: historyEntry.createdAt,
              },
              {
                state: MintQuoteState.PAID,
                displayLabel: satisfied
                  ? paymentCopy.text("timeline.onchain.confirmedLabel")
                  : paymentCopy.text("timeline.onchain.confirmingLabel"),
                stepType: onchainPaidStepType(onchainConfirmationProgress),
                info: satisfied
                  ? paymentCopy.text("timeline.onchain.waitingForMint")
                  : getOnchainConfirmationInfo(
                      onchainConfirmationProgress,
                      paymentCopy,
                    ),
              },
              {
                state: MintQuoteState.ISSUED,
                displayLabel: MINT_COPY.ISSUED.label,
                stepType: "future-small",
              },
            ];
          }

          return [
            {
              state: MintQuoteState.UNPAID,
              displayLabel: MINT_COPY.UNPAID.label,
              stepType: "next-pending",
              info: waitingInfo,
            },
            {
              state: MintQuoteState.PAID,
              displayLabel: MINT_COPY.PAID.label,
              stepType: "future-small",
            },
            {
              state: MintQuoteState.ISSUED,
              displayLabel: MINT_COPY.ISSUED.label,
              stepType: "future-small",
            },
          ];
        case MintQuoteState.PAID:
          return [
            {
              state: MintQuoteState.UNPAID,
              displayLabel: MINT_COPY.UNPAID.label,
              stepType: "complete",
              timestamp: historyEntry.createdAt,
            },
            {
              state: MintQuoteState.PAID,
              displayLabel: MINT_COPY.PAID.label,
              stepType: isOnchainMint
                ? onchainPaidStepType(onchainConfirmationProgress)
                : "next-pending",
              info:
                isOnchainMint && onchainConfirmationProgress
                  ? getOnchainConfirmationInfo(
                      onchainConfirmationProgress,
                      paymentCopy,
                    )
                  : MINT_COPY.PAID.info,
            },
            {
              state: MintQuoteState.ISSUED,
              displayLabel: MINT_COPY.ISSUED.label,
              stepType: "future-small",
            },
          ];
        case MintQuoteState.ISSUED:
          return [
            {
              state: MintQuoteState.UNPAID,
              displayLabel: MINT_COPY.UNPAID.label,
              stepType: "complete",
              timestamp: historyEntry.createdAt,
            },
            {
              state: MintQuoteState.PAID,
              displayLabel: MINT_COPY.PAID.label,
              stepType: "complete",
              timestamp: historyEntry.createdAt,
            },
            {
              state: MintQuoteState.ISSUED,
              displayLabel: MINT_COPY.ISSUED.label,
              stepType: "success",
              info: MINT_COPY.ISSUED.info(amountToNumber(historyEntry.amount)),
            },
          ];
        default:
          return [];
      }
    }

    case "melt": {
      const rawMeltState = String(historyEntry.state);
      const meltState =
        rawMeltState === "finalized"
          ? MeltQuoteState.PAID
          : rawMeltState === "pending" || rawMeltState === "executing"
            ? MeltQuoteState.PENDING
            : rawMeltState === "PAID" ||
                rawMeltState === "PENDING" ||
                rawMeltState === "UNPAID"
              ? rawMeltState
              : MeltQuoteState.UNPAID;
      const isExpired =
        meltQuote &&
        meltState === MeltQuoteState.UNPAID &&
        meltQuoteExpired(meltQuote, currentTime);

      if (isExpired) {
        return [
          {
            state: MeltQuoteState.UNPAID,
            displayLabel: MELT_COPY.UNPAID.label,
            stepType: "complete",
            timestamp: historyEntry.createdAt,
          },
          {
            state: EXPIRED_STATE,
            displayLabel: MELT_COPY.expired.label,
            stepType: "expired",
            info: MELT_COPY.expired.info,
          },
        ];
      }

      switch (meltState) {
        case MeltQuoteState.UNPAID:
          return [
            {
              state: MeltQuoteState.UNPAID,
              displayLabel: MELT_COPY.UNPAID.label,
              stepType: "next-pending",
              info: MELT_COPY.UNPAID.info,
            },
            {
              state: MeltQuoteState.PENDING,
              displayLabel: MELT_COPY.PENDING.label,
              stepType: "future-small",
            },
            {
              state: MeltQuoteState.PAID,
              displayLabel: MELT_COPY.PAID.label,
              stepType: "future-small",
            },
          ];
        case MeltQuoteState.PENDING:
          return [
            {
              state: MeltQuoteState.UNPAID,
              displayLabel: MELT_COPY.UNPAID.label,
              stepType: "complete",
              timestamp: historyEntry.createdAt,
            },
            {
              state: MeltQuoteState.PENDING,
              displayLabel: MELT_COPY.PENDING.label,
              stepType: "current",
              info: MELT_COPY.PENDING.info,
            },
            {
              state: MeltQuoteState.PAID,
              displayLabel: MELT_COPY.PAID.label,
              stepType: "future-small",
            },
          ];
        case MeltQuoteState.PAID:
          return [
            {
              state: MeltQuoteState.UNPAID,
              displayLabel: MELT_COPY.UNPAID.label,
              stepType: "complete",
              timestamp: historyEntry.createdAt,
            },
            {
              state: MeltQuoteState.PENDING,
              displayLabel: MELT_COPY.PENDING.label,
              stepType: "complete",
              timestamp: historyEntry.createdAt,
            },
            {
              state: MeltQuoteState.PAID,
              displayLabel: MELT_COPY.PAID.label,
              stepType: "success",
              info: MELT_COPY.PAID.info,
            },
          ];
        default:
          return [];
      }
    }

    case "send": {
      const isPaymentRequestMode = tokenCreated !== undefined || nostrSent;

      const sendState = String(historyEntry.state);
      if (sendState === "rolledBack" || sendState === "rolled_back") {
        const copy = isPaymentRequestMode ? PAYMENT_REQUEST_COPY : SEND_COPY;
        const rolledBackTimeline: TimelineItem[] = [
          {
            state: "prepared",
            displayLabel: copy.prepared.label,
            stepType: "complete",
            timestamp: historyEntry.createdAt,
          },
        ];
        if (nostrSent) {
          rolledBackTimeline.push({
            state: "nostrSent",
            displayLabel: PAYMENT_REQUEST_COPY.nostrSent.label,
            stepType: "complete",
            timestamp: historyEntry.createdAt,
          });
        }
        rolledBackTimeline.push({
          state: "rolledBack",
          displayLabel: copy.rolledBack.label,
          stepType: "rolled-back",
          info: copy.rolledBack.info,
        });
        return rolledBackTimeline;
      }

      if (isPaymentRequestMode) {
        switch (historyEntry.state) {
          case "prepared":
            return [
              {
                state: "prepared",
                displayLabel: PAYMENT_REQUEST_COPY.prepared.label,
                stepType: tokenCreated ? "complete" : "next-pending",
                info: PAYMENT_REQUEST_COPY.prepared.info,
                ...(tokenCreated ? { timestamp: historyEntry.createdAt } : {}),
              },
              {
                state: "nostrSent",
                displayLabel: PAYMENT_REQUEST_COPY.nostrSent.label,
                stepType: "future-small",
              },
              {
                state: "finalized",
                displayLabel: PAYMENT_REQUEST_COPY.finalized.label,
                stepType: "future-small",
              },
            ];
          case "pending":
            if (nostrSent) {
              return [
                {
                  state: "prepared",
                  displayLabel: PAYMENT_REQUEST_COPY.prepared.label,
                  stepType: "complete",
                  timestamp: historyEntry.createdAt,
                },
                {
                  state: "nostrSent",
                  displayLabel: PAYMENT_REQUEST_COPY.nostrSent.label,
                  stepType: "complete",
                  timestamp: historyEntry.createdAt,
                  info: PAYMENT_REQUEST_COPY.nostrSent.infoSent,
                },
                {
                  state: "finalized",
                  displayLabel: PAYMENT_REQUEST_COPY.finalized.label,
                  stepType: "next-pending",
                  info: SEND_COPY.pending.info,
                },
              ];
            }
            return [
              {
                state: "prepared",
                displayLabel: PAYMENT_REQUEST_COPY.prepared.label,
                stepType: "complete",
                timestamp: historyEntry.createdAt,
              },
              {
                state: "nostrSent",
                displayLabel: PAYMENT_REQUEST_COPY.nostrSent.label,
                stepType: "next-pending",
                info: PAYMENT_REQUEST_COPY.nostrSent.infoSending,
              },
              {
                state: "finalized",
                displayLabel: PAYMENT_REQUEST_COPY.finalized.label,
                stepType: "future-small",
              },
            ];
          case "finalized":
            return [
              {
                state: "prepared",
                displayLabel: PAYMENT_REQUEST_COPY.prepared.label,
                stepType: "complete",
                timestamp: historyEntry.createdAt,
              },
              {
                state: "nostrSent",
                displayLabel: PAYMENT_REQUEST_COPY.nostrSent.label,
                stepType: "complete",
                timestamp: historyEntry.createdAt,
                info: PAYMENT_REQUEST_COPY.nostrSent.infoSent,
              },
              {
                state: "finalized",
                displayLabel: PAYMENT_REQUEST_COPY.finalized.label,
                stepType: "success",
                info: PAYMENT_REQUEST_COPY.finalized.info,
              },
            ];
          default:
            return [];
        }
      }

      switch (historyEntry.state) {
        case "prepared":
          return [
            {
              state: "prepared",
              displayLabel: SEND_COPY.prepared.label,
              stepType: "current",
              info: SEND_COPY.prepared.info,
            },
            {
              state: "pending",
              displayLabel: SEND_COPY.pending.label,
              stepType: "next-pending",
            },
            {
              state: "finalized",
              displayLabel: SEND_COPY.finalized.label,
              stepType: "future-small",
            },
          ];
        case "pending":
          return [
            {
              state: "prepared",
              displayLabel: SEND_COPY.prepared.label,
              stepType: "complete",
              timestamp: historyEntry.createdAt,
            },
            {
              state: "pending",
              displayLabel: SEND_COPY.pending.label,
              stepType: "next-pending",
              info: SEND_COPY.pending.info,
            },
            {
              state: "finalized",
              displayLabel: SEND_COPY.finalized.label,
              stepType: "future-small",
            },
          ];
        case "finalized":
          return [
            {
              state: "prepared",
              displayLabel: SEND_COPY.prepared.label,
              stepType: "complete",
              timestamp: historyEntry.createdAt,
            },
            {
              state: "pending",
              displayLabel: SEND_COPY.pending.label,
              stepType: "complete",
              timestamp: historyEntry.createdAt,
            },
            {
              state: "finalized",
              displayLabel: SEND_COPY.finalized.label,
              stepType: "success",
              info: SEND_COPY.finalized.info,
            },
          ];
        default:
          return [];
      }
    }

    case "receive": {
      const receiveState = String(historyEntry.state);

      // Incoming payment-request receive ("Fixed Amount → as Ecash"): a distinct
      // milestone timeline that leads with "waiting for payment on nostr" — the
      // step a normal token receive lacks. Detected off the synthetic pending
      // row's flag (paymentRequestPending) or a claimed child receive's source.
      const meta = historyEntry.metadata;
      const isReceivePaymentRequestMode =
        meta?.paymentRequestPending === "1" || meta?.source === "payment-request";
      if (isReceivePaymentRequestMode) {
        const PR = RECEIVE_COPY.paymentRequest;
        const requestedComplete = {
          state: "requested",
          displayLabel: PR.requested.label,
          stepType: "complete" as const,
          timestamp: historyEntry.createdAt,
        };
        const added = (stepType: TimelineStepType): TimelineItem => ({
          state: "added",
          displayLabel: RECEIVE_COPY.redeemed.label,
          stepType,
          ...(stepType === "success"
            ? { info: RECEIVE_COPY.redeemed.info(amountToNumber(historyEntry.amount)) }
            : {}),
        });

        // The list pending row is `state:executing` + paymentRequestPending — it
        // must ALWAYS read "waiting for payment", never the generic "redeeming".
        if (meta?.paymentRequestPending === "1") {
          return [
            {
              state: "requested",
              displayLabel: PR.requested.label,
              stepType: "next-pending",
              info: PR.requested.info,
            },
            { state: "paid", displayLabel: PR.paid.label, stepType: "future-small" },
            added("future-small"),
          ];
        }
        if (receiveState === "rolledBack" || receiveState === "rolled_back") {
          return [
            requestedComplete,
            {
              state: "alreadySpent",
              displayLabel: RECEIVE_COPY.alreadySpent.label,
              stepType: "already-spent",
              info: RECEIVE_COPY.alreadySpent.info,
            },
          ];
        }
        if (receiveState === "finalized") {
          return [
            requestedComplete,
            {
              state: "paid",
              displayLabel: PR.paid.label,
              stepType: "complete",
              timestamp: historyEntry.createdAt,
            },
            added("success"),
          ];
        }
        // prepared / executing: the payer paid, the claim is running.
        return [
          requestedComplete,
          {
            state: "paid",
            displayLabel: PR.paid.label,
            stepType: "current",
            info: PR.paid.info,
          },
          added("future-small"),
        ];
      }

      if (receiveState === "rolledBack" || receiveState === "rolled_back") {
        return [
          {
            state: "pending",
            displayLabel: RECEIVE_COPY.pending.label,
            stepType: "complete",
            timestamp: historyEntry.createdAt,
          },
          {
            state: "alreadySpent",
            displayLabel: RECEIVE_COPY.alreadySpent.label,
            stepType: "already-spent",
            info: RECEIVE_COPY.alreadySpent.info,
          },
        ];
      }

      if (historyEntry.state === "prepared") {
        return [
          {
            state: "pending",
            displayLabel: RECEIVE_COPY.pending.label,
            stepType: "next-pending",
            info: RECEIVE_COPY.pending.info,
          },
          {
            state: "redeemed",
            displayLabel: RECEIVE_COPY.redeemed.label,
            stepType: "future-small",
          },
        ];
      }

      if (receiveState === "executing") {
        return [
          {
            state: "accepted",
            displayLabel: RECEIVE_COPY.accepted.label,
            stepType: "complete",
            timestamp: historyEntry.createdAt,
          },
          {
            state: "executing",
            displayLabel: RECEIVE_COPY.waiting.label,
            stepType: "waiting",
            info: RECEIVE_COPY.waiting.info,
          },
          {
            state: "redeemed",
            displayLabel: RECEIVE_COPY.redeemed.label,
            stepType: "future-small",
          },
        ];
      }

      return [
        {
          state: "pending",
          displayLabel: RECEIVE_COPY.pending.label,
          stepType: "complete",
          timestamp: historyEntry.createdAt,
        },
        {
          state: "redeemed",
          displayLabel: RECEIVE_COPY.redeemed.label,
          stepType: "success",
          info: RECEIVE_COPY.redeemed.info(amountToNumber(historyEntry.amount)),
        },
      ];
    }

    default:
      return [];
  }
}

export function buildTimeline(input: BuildTimelineInput): TimelineItem[] {
  const timeline = buildTimelineItems(input);
  logger.info("history.timeline.build.result", {
    type: input.historyEntry.type,
    state: String((input.historyEntry as EntryRecord).state ?? ""),
    itemCount: timeline.length,
    stepTypes: timeline.map((item) => item.stepType),
    currentStates: timeline
      .filter(
        (item) =>
          item.stepType === "current" ||
          item.stepType === "waiting" ||
          item.stepType === "next-pending" ||
          item.stepType === "success" ||
          item.stepType === "expired" ||
          item.stepType === "rolled-back" ||
          item.stepType === "already-spent",
      )
      .map((item) => item.state),
    hasMeltQuote: !!input.meltQuote,
    tokenCreated: input.tokenCreated ?? null,
    nostrSent: input.nostrSent ?? null,
    hasOnchainConfirmationProgress: !!input.onchainConfirmationProgress,
    onchainSatisfied: input.onchainConfirmationProgress?.isSatisfied ?? null,
  });
  return timeline;
}

export function getCardLabel(
  historyEntry: HistoryEntry,
  timeline: TimelineItem[],
  tokenCreated?: boolean,
  nostrSent?: boolean,
  paymentCopy: PaymentCopyResolver = DEFAULT_PAYMENT_COPY,
): string {
  const text = paymentCopy.text;
  const isFailed = timeline.some(
    (item) =>
      item.stepType === "expired" ||
      item.stepType === "rolled-back" ||
      item.stepType === "already-spent",
  );

  let status = "";

  switch (historyEntry.type) {
    case "mint": {
      const mintState = getMintTimelineState(historyEntry);
      const hasObservedPayment = timeline.some(
        (item) =>
          item.state === MintQuoteState.PAID &&
          (item.stepType === "next-pending" || item.stepType === "current"),
      );
      if (isFailed) {
        status = text("timeline.status.failed");
      } else if (mintState === MintQuoteState.ISSUED) {
        status = text("timeline.status.complete");
      } else if (mintState === MintQuoteState.PAID || hasObservedPayment) {
        status = text("timeline.status.inProgress");
      } else {
        status = text("timeline.status.awaitingPayment");
      }
      // Intentional collapse with the 'receive' branch: a Lightning mint quote and a
      // token-redemption receive both surface to the user as 'incoming payment'.
      const label = `${text("timeline.flow.receive")} • ${status}`;
      logger.debug("history.timeline.cardLabel.result", {
        type: historyEntry.type,
        state: String((historyEntry as EntryRecord).state ?? ""),
        status,
        isFailed,
        label,
        timelineItemCount: timeline.length,
        tokenCreated: tokenCreated ?? null,
        nostrSent: nostrSent ?? null,
      });
      return label;
    }
    case "melt": {
      if (isFailed) {
        status = text("timeline.status.failed");
      } else if (historyEntry.state === MeltQuoteState.PAID) {
        status = text("timeline.status.complete");
      } else if (historyEntry.state === MeltQuoteState.PENDING) {
        status = text("timeline.status.inProgress");
      } else {
        status = text("timeline.status.ready");
      }
      const label = `${text("timeline.flow.send")} • ${status}`;
      logger.debug("history.timeline.cardLabel.result", {
        type: historyEntry.type,
        state: String((historyEntry as EntryRecord).state ?? ""),
        status,
        isFailed,
        label,
        timelineItemCount: timeline.length,
        tokenCreated: tokenCreated ?? null,
        nostrSent: nostrSent ?? null,
      });
      return label;
    }
    case "send": {
      const isPaymentRequestMode = tokenCreated !== undefined || nostrSent;
      const label = isPaymentRequestMode
        ? text("timeline.flow.payment")
        : text("timeline.flow.send");
      if (historyEntry.state === "rolledBack") {
        status = text("timeline.status.cancelled");
      } else if (historyEntry.state === "finalized") {
        status = text("timeline.status.complete");
      } else if (historyEntry.state === "pending") {
        status = text("timeline.status.inProgress");
      } else {
        status = text("timeline.status.ready");
      }
      const cardLabel = `${label} • ${status}`;
      logger.debug("history.timeline.cardLabel.result", {
        type: historyEntry.type,
        state: String((historyEntry as EntryRecord).state ?? ""),
        status,
        isFailed,
        label: cardLabel,
        isPaymentRequestMode,
        timelineItemCount: timeline.length,
        tokenCreated: tokenCreated ?? null,
        nostrSent: nostrSent ?? null,
      });
      return cardLabel;
    }
    case "receive": {
      const receiveState = String(historyEntry.state);
      if (receiveState === "finalized") {
        status = text("timeline.status.complete");
      } else if (receiveState === "executing") {
        status = text("timeline.status.waiting");
      } else if (
        receiveState === "rolledBack" ||
        receiveState === "rolled_back"
      ) {
        status = text("timeline.status.alreadySpent");
      } else {
        status = text("timeline.status.pending");
      }
      const label = `${text("timeline.flow.receive")} • ${status}`;
      logger.debug("history.timeline.cardLabel.result", {
        type: historyEntry.type,
        state: String((historyEntry as EntryRecord).state ?? ""),
        status,
        isFailed,
        label,
        timelineItemCount: timeline.length,
        tokenCreated: tokenCreated ?? null,
        nostrSent: nostrSent ?? null,
      });
      return label;
    }
    default:
      const label = text("timeline.flow.transaction");
      logger.debug("history.timeline.cardLabel.result", {
        type: String((historyEntry as EntryRecord).type ?? ""),
        state: String((historyEntry as EntryRecord).state ?? ""),
        status: "unknown",
        isFailed,
        label,
        timelineItemCount: timeline.length,
        tokenCreated: tokenCreated ?? null,
        nostrSent: nostrSent ?? null,
      });
      return label;
  }
}

export function getStatusHeader(timeline: TimelineItem[]): string {
  const current = timeline.find(
    (item) =>
      item.stepType === "current" ||
      item.stepType === "waiting" ||
      item.stepType === "success" ||
      item.stepType === "expired" ||
      item.stepType === "rolled-back" ||
      item.stepType === "already-spent",
  );
  if (current) {
    const header = current.displayLabel.toUpperCase();
    logger.debug("history.timeline.statusHeader.result", {
      reason: "current",
      header,
      stepType: current.stepType,
      state: current.state,
      timelineItemCount: timeline.length,
    });
    return header;
  }
  const nextUp = timeline.find((item) => item.stepType === "next-pending");
  if (nextUp) {
    const header = nextUp.displayLabel.toUpperCase();
    logger.debug("history.timeline.statusHeader.result", {
      reason: "next-pending",
      header,
      stepType: nextUp.stepType,
      state: nextUp.state,
      timelineItemCount: timeline.length,
    });
    return header;
  }
  const header =
    timeline[timeline.length - 1]?.displayLabel.toUpperCase() || "";
  logger.debug("history.timeline.statusHeader.result", {
    reason: header ? "last-item" : "empty",
    header,
    timelineItemCount: timeline.length,
  });
  return header;
}

type StatusColorType = "default" | "success" | "error" | "warning";

export function getStatusColorType(timeline: TimelineItem[]): StatusColorType {
  const hasExpired = timeline.some((item) => item.stepType === "expired");
  const hasRolledBack = timeline.some(
    (item) => item.stepType === "rolled-back",
  );
  const hasAlreadySpent = timeline.some(
    (item) => item.stepType === "already-spent",
  );
  const hasWaiting = timeline.some((item) => item.stepType === "waiting");
  const hasSuccess = timeline.some((item) => item.stepType === "success");

  let colorType: StatusColorType = "default";
  let reason = "default";
  if (hasExpired) {
    colorType = "error";
    reason = "expired";
  } else if (hasAlreadySpent) {
    colorType = "warning";
    reason = "already-spent";
  } else if (hasRolledBack) {
    colorType = "warning";
    reason = "rolled-back";
  } else if (hasWaiting) {
    colorType = "warning";
    reason = "waiting";
  } else if (hasSuccess) {
    colorType = "success";
    reason = "success";
  }
  logger.debug("history.timeline.statusColor.result", {
    colorType,
    reason,
    hasExpired,
    hasRolledBack,
    hasAlreadySpent,
    hasWaiting,
    hasSuccess,
    timelineItemCount: timeline.length,
  });
  return colorType;
}
