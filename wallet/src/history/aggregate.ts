// ---------------------------------------------------------------------------
// Transaction source aggregation (framework-agnostic)
// ---------------------------------------------------------------------------
//
// coco v2 projects history straight from the operation repositories,
// including prepared/pending melts — the v1-era melt supplement is gone.
// One kind of activity is still not projected: received-but-unredeemed
// ecash — receive operations stuck in `executing` (coco only projects
// finalized/rolled_back receives).
//
// To present one complete list, callers supplement the paginated coco history
// with in-flight receives. This module owns that aggregation as pure functions
// + thin manager reads so any colada consumer (React or otherwise) shares one
// implementation instead of re-deriving the merge/dedupe per wallet.

import type {
  HistoryEntry,
  Manager,
  PaymentRequestReceiveOperation,
  ReceiveOperation,
} from "@cashu/coco-core";

import { logger } from "../logger";
import { inFlightReceiveToHistoryEntry } from "./inFlightReceives";
import { pendingPaymentRequestToHistoryEntry } from "./pendingPaymentRequests";

/**
 * Synthetic history entries for received-but-unredeemed (executing) ecash.
 */
export async function listInFlightReceiveEntries(
  manager: Manager,
): Promise<HistoryEntry[]> {
  const ops: ReceiveOperation[] = await manager.ops.receive.listInFlight();
  logger.debug("history.aggregate.inFlightReceives", { count: ops.length });
  return ops.map(inFlightReceiveToHistoryEntry);
}

/**
 * Pending requests older than this are hidden from the transaction list. The
 * operation stays `active` in coco (a payer holding the creq can still pay it
 * and the claim will surface as a real receive) — this is a display cutoff
 * only, so week-old unpaid requests don't sit in history forever.
 */
export const PENDING_PAYMENT_REQUEST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Synthetic history entries for ACTIVE incoming payment requests (NUT-18)
 * awaiting payment — the requests coco never projects into history. Limited
 * to requests created within {@link PENDING_PAYMENT_REQUEST_MAX_AGE_MS}
 * (coco stamps `createdAt` in epoch ms at create time).
 */
export async function listPendingPaymentRequestEntries(
  manager: Manager,
  now: number = Date.now(),
): Promise<HistoryEntry[]> {
  const ops: PaymentRequestReceiveOperation[] =
    await manager.paymentRequests.incoming.list({ state: "active" });
  const cutoff = now - PENDING_PAYMENT_REQUEST_MAX_AGE_MS;
  const fresh = ops.filter((op) => op.createdAt >= cutoff);
  logger.debug("history.aggregate.pendingPaymentRequests", {
    count: ops.length,
    shown: fresh.length,
  });
  return fresh.map(pendingPaymentRequestToHistoryEntry);
}

function operationId(entry: HistoryEntry): string | undefined {
  const opId = (entry as { operationId?: unknown }).operationId;
  return typeof opId === "string" && opId.length > 0 ? opId : undefined;
}

function requestOperationId(entry: HistoryEntry): string | undefined {
  const reqId = (entry as { metadata?: Record<string, unknown> }).metadata
    ?.requestOperationId;
  return typeof reqId === "string" && reqId.length > 0 ? reqId : undefined;
}

/**
 * Merge paginated coco history with the in-flight-receive supplement,
 * deduplicating receives by operationId (so a later finalize from coco
 * history wins), then sorting newest-first.
 *
 * Pure: callers own fetching/caching; this only combines.
 */
export function mergeTransactionSources(input: {
  cocoHistory: readonly HistoryEntry[];
  receiveEntries: readonly HistoryEntry[];
  /** Synthetic pending incoming-payment-request rows (awaiting payment). */
  pendingRequestEntries?: readonly HistoryEntry[];
}): HistoryEntry[] {
  const { cocoHistory, receiveEntries, pendingRequestEntries = [] } = input;

  const existingReceiveOpIds = new Set<string>();
  for (const entry of cocoHistory) {
    if (entry.type === "receive") {
      const opId = operationId(entry);
      if (opId) existingReceiveOpIds.add(opId);
    }
  }

  const newReceives = receiveEntries.filter((r) => {
    const opId = operationId(r);
    return opId ? !existingReceiveOpIds.has(opId) : true;
  });

  // A pending-request row hands off to the real receive once a payer pays: the
  // request stays `active` until coco finalizes the child receive, so both can
  // briefly coexist. Drop the pending row as soon as a receive that cites it
  // (`metadata.requestOperationId`) appears in coco history or the in-flight
  // supplement — the money movement supersedes the awaiting-payment stub.
  const claimedRequestOpIds = new Set<string>();
  for (const entry of [...cocoHistory, ...newReceives]) {
    const reqId = requestOperationId(entry);
    if (reqId) claimedRequestOpIds.add(reqId);
  }
  const newPendingRequests = pendingRequestEntries.filter((entry) => {
    const opId = operationId(entry);
    return opId ? !claimedRequestOpIds.has(opId) : true;
  });

  const supplements = [...newReceives, ...newPendingRequests];
  if (supplements.length === 0) return [...cocoHistory];
  // Match coco's compareHistoryEntries (createdAt DESC, id DESC): without the
  // id tiebreaker, equal-timestamp rows would order differently depending on
  // whether a supplement happens to be present.
  return [...cocoHistory, ...supplements].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
    return b.id.localeCompare(a.id);
  });
}

/**
 * True when two merged histories are display-equivalent — same length and same
 * (id, state) per row. `state` is the only field that mutates after creation
 * and the only one bucketing depends on, so this is a safe reference-stability
 * gate for React snapshots.
 */
export function sameTransactionList(
  a: readonly HistoryEntry[],
  b: readonly HistoryEntry[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      (x as { state?: unknown }).state !== (y as { state?: unknown }).state
    ) {
      return false;
    }
  }
  return true;
}
