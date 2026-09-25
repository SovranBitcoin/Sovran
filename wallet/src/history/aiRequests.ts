// ---------------------------------------------------------------------------
// AI request grouping (framework-agnostic)
// ---------------------------------------------------------------------------
//
// One pay-per-request AI call is two ledger movements: the token handed to the
// node, and the unused remainder it hands back when the stream finalizes. Shown
// separately they read as an unexplained send followed by an unexplained
// receive, and when the request fails they read as a *cancelled* payment — which
// is the one thing they are not. The money did move; it came back.
//
// Both legs already carry one `ai.groupId` with a `payment` / `change` role
// (see the app's `paymentScope`), so this collapses them the way a swap's legs
// are collapsed, and names the three outcomes apart:
//
//   - `pending`   — a leg is still in flight; the total is not known yet.
//   - `cancelled` — the payment never completed. Nothing left the wallet.
//   - `refunded`  — it completed and every sat came back. The request failed,
//                   but this is a refund, not a rollback.
//   - `spent`     — the usual case: payment minus change is what the answer cost.

import type { HistoryEntry } from "@cashu/coco-core";

import { amountToNumber } from "../amount";
import { getAnnotation } from "../annotations/selectors";
import {
  bucketTransaction,
  isSendTokenCancelled,
  isSettledReceiveHistoryEntry,
  isSettledSpendHistoryEntry,
} from "./filters";

export type AiRequestState = "pending" | "cancelled" | "refunded" | "spent";

export interface AiRequestGroup {
  groupId: string;
  /** Payment leg first, then the change legs, each in arrival order. */
  legs: HistoryEntry[];
  state: AiRequestState;
  /** What was handed to the node. */
  paidAmount: number;
  /** What came back — the whole of it when the request failed. */
  refundedAmount: number;
  /** `paidAmount - refundedAmount`: what the answer actually cost. */
  netAmount: number;
  unit: string;
  /** The most recent leg, so the group ranks by latest activity. */
  createdAt: number;
  sessionId?: string;
  messageId?: string;
  model?: string;
}

/** The AI annotation on a merged entry, or null. */
export function getAiPayment(entry: {
  metadata?: Record<string, string> | undefined;
}): NonNullable<ReturnType<typeof getAnnotation>["ai"]> | null {
  return getAnnotation(entry).ai ?? null;
}

/** True for a leg that belongs to a grouped AI request. */
export function isAiRequestLeg(entry: {
  metadata?: Record<string, string> | undefined;
}): boolean {
  return !!getAiPayment(entry)?.groupId;
}

function settled(entry: HistoryEntry): boolean {
  return isSettledSpendHistoryEntry(entry) || isSettledReceiveHistoryEntry(entry);
}

function buildGroup(groupId: string, unsorted: HistoryEntry[]): AiRequestGroup {
  // Payment first: it is the leg that explains the group, and the one whose
  // metadata (model, message) the row reads.
  const legs = [...unsorted].sort((a, b) => {
    const rank = (entry: HistoryEntry) =>
      getAiPayment(entry)?.role === "payment" ? 0 : 1;
    return rank(a) - rank(b) || a.createdAt - b.createdAt;
  });
  const paymentLegs = legs.filter(
    (leg) => getAiPayment(leg)?.role === "payment",
  );
  const changeLegs = legs.filter((leg) => getAiPayment(leg)?.role === "change");

  // Only SETTLED movements count toward the totals. A change leg that never
  // redeemed is money we did not get back, and counting it would report a
  // refund that never landed.
  const paidAmount = paymentLegs
    .filter(settled)
    .reduce((sum, leg) => sum + amountToNumber(leg.amount ?? 0), 0);
  const refundedAmount = changeLegs
    .filter(settled)
    .reduce((sum, leg) => sum + amountToNumber(leg.amount ?? 0), 0);

  const anyPending = legs.some((leg) => bucketTransaction(leg) === "pending");
  const paymentSettled = paymentLegs.some(settled);
  const paymentCancelled =
    paymentLegs.length > 0 && paymentLegs.every(isSendTokenCancelled);

  const state: AiRequestState = anyPending
    ? "pending"
    : // The token never left. This is the only outcome that is genuinely a
      // cancellation, and the only one where nothing was spent.
      !paymentSettled && paymentCancelled
      ? "cancelled"
      : paymentSettled && refundedAmount >= paidAmount
        ? "refunded"
        : "spent";

  const annotation = getAiPayment(paymentLegs[0] ?? legs[0]);
  return {
    groupId,
    legs,
    state,
    paidAmount,
    refundedAmount,
    netAmount: Math.max(0, paidAmount - refundedAmount),
    unit: legs.find((leg) => leg.unit)?.unit ?? "sat",
    createdAt: legs.reduce((max, leg) => Math.max(max, leg.createdAt), 0),
    ...(annotation?.sessionId ? { sessionId: annotation.sessionId } : {}),
    ...(annotation?.messageId ? { messageId: annotation.messageId } : {}),
    ...(annotation?.model ? { model: annotation.model } : {}),
  };
}

/**
 * Collapse every entry sharing an `ai.groupId` into one group per request,
 * newest activity first. Entries without the annotation are ignored — the
 * caller keeps rendering those itself.
 */
export function groupAiRequests(
  entries: readonly HistoryEntry[],
): AiRequestGroup[] {
  const byGroup = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const groupId = getAiPayment(entry)?.groupId;
    if (!groupId) continue;
    const legs = byGroup.get(groupId);
    if (legs) legs.push(entry);
    else byGroup.set(groupId, [entry]);
  }
  return [...byGroup.entries()]
    .map(([groupId, legs]) => buildGroup(groupId, legs))
    .sort((a, b) => b.createdAt - a.createdAt);
}
