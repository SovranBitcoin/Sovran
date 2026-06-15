// ---------------------------------------------------------------------------
// In-flight (unredeemed) receive helpers — sovran-app
// ---------------------------------------------------------------------------
//
// When a P2PK-locked (or any) ecash token is received while the mint/network
// is unreachable, coco signs the proofs locally but cannot swap them yet. The
// receive operation is persisted in coco's ReceiveOperationRepository in the
// `executing` state and survives restart, but coco only projects `finalized`/
// `rolled_back` receives into the history repository. That leaves the funds
// invisible: not in spendable balance (proofs aren't `ready`) and not in the
// transactions list (no history row).
//
// These helpers bridge that gap on the app side. `manager.ops.receive
// .listInFlight()` returns the `executing` operations; we convert each into a
// synthetic receive `HistoryEntry` so the transactions list can show it — as an
// ordinary receive row, but bucketed under Pending until it is redeemed (the
// predicate below drives that bucketing; the REDEEMING balance pill conveys the
// aggregate unredeemed total).
//
// The synthetic id/shape mirrors colada's `buildPendingReceiveEntry`
// (features/send/lib/sovranPaymentConfig.ts) so a row tapped here opens the
// same `/receiveToken` screen and a later finalize dedupes by `operationId`.

import type { HistoryEntry, ReceiveOperation } from '@cashu/coco-core';

/** State coco uses for a received-but-not-yet-swapped receive operation. */
const IN_FLIGHT_RECEIVE_STATE = 'executing';

/**
 * Convert an in-flight (executing) coco receive operation into a synthetic
 * pending receive history entry for display in the transactions timeline.
 */
export function inFlightReceiveToHistoryEntry(operation: ReceiveOperation): HistoryEntry {
  const entry = {
    id: `receive-${operation.id}`,
    type: 'receive' as const,
    source: 'operation' as const,
    operationId: operation.id,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    mintUrl: operation.mintUrl,
    unit: operation.unit ?? 'sat',
    amount: operation.amount,
    state: IN_FLIGHT_RECEIVE_STATE,
    metadata: {
      operationId: operation.id,
      pendingReason: 'network',
    },
  };
  // coco's `ReceiveHistoryState` only models `finalized`/`rolled_back`, so the
  // `executing` state is not assignable. The entry is display-only and never
  // written back to coco, so the cast is safe. The `executing` state makes the
  // receive detail screen treat it as a pending receive (isReceiveTokenPending)
  // while the transactions list renders it like any other receive row.
  return entry as unknown as HistoryEntry;
}

/**
 * True when a history entry is a synthetic in-flight (unredeemed) receive.
 * Used only to bucket it under Pending — the row itself renders exactly like a
 * normal receive (no special label/colour/icon).
 */
export function isInFlightReceiveEntry(entry: HistoryEntry): boolean {
  return (
    entry.type === 'receive' &&
    String((entry as { state?: unknown }).state ?? '') === IN_FLIGHT_RECEIVE_STATE
  );
}
