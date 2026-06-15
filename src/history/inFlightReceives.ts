import type { HistoryEntry, ReceiveOperation } from "@cashu/coco-core";

// ---------------------------------------------------------------------------
// In-flight (unredeemed) receive helpers
// ---------------------------------------------------------------------------
//
// When a (typically P2PK-locked) ecash token is received while the mint is
// unreachable, coco signs the proofs locally but cannot swap them yet, so the
// receive operation is persisted in the `executing` state and survives restart.
// coco only projects `finalized`/`rolled_back` receives into history, so these
// funds are otherwise invisible: excluded from spendable balance (proofs are
// not `ready`) and absent from the history list.
//
// `inFlightReceiveToHistoryEntry` converts such an operation into a synthetic
// receive `HistoryEntry` so any colada consumer can render it in the
// transactions list. The `executing` state makes `isReceiveTokenPending`
// (and therefore `bucketTransaction`) treat it as pending, and a later
// finalize is deduped by `operationId`.

/** State coco uses for a received-but-not-yet-swapped receive operation. */
const IN_FLIGHT_RECEIVE_STATE = "executing";

export function inFlightReceiveToHistoryEntry(
  operation: ReceiveOperation,
): HistoryEntry {
  const entry = {
    id: `receive-${operation.id}`,
    type: "receive" as const,
    source: "operation" as const,
    operationId: operation.id,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    mintUrl: operation.mintUrl,
    unit: operation.unit ?? "sat",
    amount: operation.amount,
    state: IN_FLIGHT_RECEIVE_STATE,
    metadata: {
      operationId: operation.id,
      pendingReason: "network",
    },
  };
  // coco's `ReceiveHistoryState` only models `finalized`/`rolled_back`, so the
  // `executing` state is not assignable. The entry is display-only and never
  // written back to coco, so the cast is safe.
  return entry as unknown as HistoryEntry;
}
