// ---------------------------------------------------------------------------
// Transaction source aggregation (framework-agnostic)
// ---------------------------------------------------------------------------
//
// coco's HistoryRepository is the canonical transaction log, but two kinds of
// activity are not projected into it:
//
//   1. v3 melt operations (`prepareMeltBolt11`/`executeMelt`) — stored in the
//      MeltOperationRepository but never emit `melt-quote:created`.
//   2. received-but-unredeemed ecash — receive operations stuck in `executing`
//      (coco only projects finalized/rolled_back receives).
//
// To present one complete list, callers supplement the paginated coco history
// with these two sources. This module owns that aggregation as pure functions
// + thin manager reads so any colada consumer (React or otherwise) shares one
// implementation instead of re-deriving the merge/dedupe per wallet.

import { MeltQuoteState } from "@cashu/cashu-ts";
import type {
  HistoryEntry,
  Manager,
  MeltHistoryEntry,
  MeltOperation,
  MeltOperationState,
  ReceiveOperation,
} from "@cashu/coco-core";

import { logger } from "../logger";
import { inFlightReceiveToHistoryEntry } from "./inFlightReceives";

// coco does not expose finalized melt operations through a public list API
// (only `listPrepared`/`listInFlight`), so the supplement reads the repository
// directly. Single cast site; promote to a public coco API when one exists.
interface MeltRepositoryReach {
  meltOperationRepository: {
    getByState(state: MeltOperationState): Promise<MeltOperation[]>;
  };
}

function meltOpStateToHistoryState(
  opState: MeltOperationState,
): MeltHistoryEntry["state"] {
  if (opState === "finalized") return MeltQuoteState.PAID;
  if (opState === "pending" || opState === "executing")
    return MeltQuoteState.PENDING;
  return MeltQuoteState.UNPAID;
}

/**
 * Convert a coco melt operation into a MeltHistoryEntry. Returns null for
 * operation variants that don't carry a quoteId/amount yet (e.g. `init`).
 */
export function meltOpToHistoryEntry(
  op: MeltOperation,
): MeltHistoryEntry | null {
  const opAny = op as Pick<MeltHistoryEntry, "quoteId" | "amount">;
  if (!opAny.quoteId || opAny.amount == null) return null;
  return {
    id: op.id,
    type: "melt",
    source: "operation",
    operationId: op.id,
    createdAt: op.createdAt,
    mintUrl: op.mintUrl,
    unit: "sat",
    quoteId: opAny.quoteId,
    state: meltOpStateToHistoryState(op.state),
    amount: opAny.amount,
  } as MeltHistoryEntry;
}

/**
 * Supplemental melt history entries (finalized + pending + prepared). Rolled
 * back melts are intentionally excluded.
 */
export async function listMeltSupplementEntries(
  manager: Manager,
): Promise<MeltHistoryEntry[]> {
  const repo = (manager as unknown as MeltRepositoryReach).meltOperationRepository;
  const [finalized, pending, prepared] = await Promise.all([
    repo.getByState("finalized"),
    repo.getByState("pending"),
    repo.getByState("prepared"),
  ]);
  const entries = [...finalized, ...pending, ...prepared]
    .map(meltOpToHistoryEntry)
    .filter((entry): entry is MeltHistoryEntry => entry !== null);
  logger.debug("history.aggregate.meltSupplement", {
    finalized: finalized.length,
    pending: pending.length,
    prepared: prepared.length,
    converted: entries.length,
  });
  return entries;
}

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

function operationId(entry: HistoryEntry): string | undefined {
  const opId = (entry as { operationId?: unknown }).operationId;
  return typeof opId === "string" && opId.length > 0 ? opId : undefined;
}

/**
 * Merge paginated coco history with the melt + in-flight-receive supplements,
 * deduplicating melts by quoteId and receives by operationId (so a later
 * finalize from coco history wins), then sorting newest-first.
 *
 * Pure: callers own fetching/caching; this only combines.
 */
export function mergeTransactionSources(input: {
  cocoHistory: readonly HistoryEntry[];
  meltEntries: readonly MeltHistoryEntry[];
  receiveEntries: readonly HistoryEntry[];
}): HistoryEntry[] {
  const { cocoHistory, meltEntries, receiveEntries } = input;

  const existingQuoteIds = new Set<string>();
  const existingReceiveOpIds = new Set<string>();
  for (const entry of cocoHistory) {
    if (entry.type === "melt") {
      const quoteId = (entry as MeltHistoryEntry).quoteId;
      if (quoteId) existingQuoteIds.add(quoteId);
    } else if (entry.type === "receive") {
      const opId = operationId(entry);
      if (opId) existingReceiveOpIds.add(opId);
    }
  }

  const newMelts = meltEntries.filter((m) => !existingQuoteIds.has(m.quoteId));
  const newReceives = receiveEntries.filter((r) => {
    const opId = operationId(r);
    return opId ? !existingReceiveOpIds.has(opId) : true;
  });

  const supplements = [...newMelts, ...newReceives];
  if (supplements.length === 0) return [...cocoHistory];
  return [...cocoHistory, ...supplements].sort(
    (a, b) => b.createdAt - a.createdAt,
  );
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
