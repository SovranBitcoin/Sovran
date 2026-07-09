// ---------------------------------------------------------------------------
// Timeline classification — card label, status header, status color
// ---------------------------------------------------------------------------
//
// Moved verbatim from the old history/timeline.ts. Output (strings + colors
// for every state) is pinned by the wallet tests and the app's scenario
// snapshots — behavior must stay identical to the old switch.

import { MintQuoteState, MeltQuoteState } from "@cashu/cashu-ts";
import type { HistoryEntry } from "@cashu/coco-core";

import type { PaymentCopyResolver } from "../../copy";
import { logger } from "../../logger";
import {
  DEFAULT_PAYMENT_COPY,
  getMintTimelineState,
  type EntryRecord,
} from "./context";
import type { TimelineItem, TimelineStepType } from "./types";

const SETTLED_STEP_TYPES: ReadonlySet<TimelineStepType> = new Set([
  "complete",
  "current",
  "waiting",
  "success",
]);

/** The "completed-ish" step types: the flow has arrived at (or passed) the
 *  row — complete | current | waiting | success. One owner for the set. */
export function isSettledStepType(stepType: TimelineStepType): boolean {
  return SETTLED_STEP_TYPES.has(stepType);
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
      const meltRolledBack =
        historyEntry.state === "rolledBack" ||
        historyEntry.state === "rolled_back" ||
        historyEntry.state === "rolling_back" ||
        historyEntry.state === "failed";
      if (meltRolledBack) {
        status = text("timeline.status.cancelled");
      } else if (isFailed) {
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
