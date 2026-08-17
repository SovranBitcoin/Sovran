import type {
  HistoryEntry,
  PaymentRequestReceiveOperation,
} from "@cashu/coco-core";

import { amountToNumber } from "../amount";

// ---------------------------------------------------------------------------
// Pending incoming payment requests (NUT-18) as transaction rows
// ---------------------------------------------------------------------------
//
// coco stores an incoming payment request as a `PaymentRequestReceiveOperation`
// in its OWN repository (state `active` | `completed` | `cancelled`). It is not
// a `HistoryType` and is never projected into the transaction history — so a
// "Receive -> Fixed Amount -> as Ecash" request is invisible in the timeline
// until a payer actually pays it, at which point coco spawns a child `receive`
// operation that DOES project to history.
//
// This mirrors `inFlightReceives`: it converts an ACTIVE request into a
// synthetic pending `receive` HistoryEntry so the awaiting-payment request
// shows in the list with a stable id and can be reopened, then hands off to the
// real receive row once paid (the request flips to `completed` and drops out of
// `incoming.list({ state: 'active' })`, while the child receive appears).

/** State that buckets the row as pending via `isReceiveTokenPending`. */
const PENDING_REQUEST_STATE = "executing";

/**
 * Metadata marker distinguishing an awaiting-payment REQUEST from money already
 * received via a payment request. coco tags the claimed child receive with
 * `source: 'payment-request'` too, so the row renderer keys its "Requested /
 * Awaiting payment" treatment off this pending flag, not off `source`.
 */
const PAYMENT_REQUEST_PENDING_FLAG = "paymentRequestPending";

export function pendingPaymentRequestToHistoryEntry(
  operation: PaymentRequestReceiveOperation,
): HistoryEntry {
  const amount = amountToNumber(operation.amount);
  const entry = {
    id: `pr-${operation.id}`,
    type: "receive" as const,
    source: "operation" as const,
    operationId: operation.id,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    // A request can advertise several mints; the row shows the first for the
    // mint chip. The detail screen reconstructs the full list from metadata.
    mintUrl: operation.mints[0] ?? "",
    unit: operation.unit,
    amount: operation.amount,
    state: PENDING_REQUEST_STATE,
    metadata: {
      operationId: operation.id,
      source: "payment-request",
      [PAYMENT_REQUEST_PENDING_FLAG]: "1",
      // Everything the detail route needs to reopen the request screen without
      // a re-fetch. `metadata` is a flat string map, so numbers/arrays are
      // stringified and parsed back by the navigation builder.
      encodedRequest: operation.encodedRequest,
      requestAmount: String(amount),
      requestUnit: operation.unit,
      requestMints: JSON.stringify(operation.mints),
      singleUse: operation.singleUse ? "1" : "0",
    },
  };
  // coco's `ReceiveHistoryState` only models `finalized`/`rolled_back`, so the
  // `executing` state is not assignable. The entry is display-only and never
  // written back to coco, so the cast is safe (same pattern as inFlightReceives).
  return entry as unknown as HistoryEntry;
}

/** True when a merged history row is a synthetic pending payment-request row. */
export function isPendingPaymentRequestEntry(entry: {
  metadata?: Record<string, string> | undefined;
}): boolean {
  return entry.metadata?.[PAYMENT_REQUEST_PENDING_FLAG] === "1";
}
