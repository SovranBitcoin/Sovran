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

import type { HistoryEntry, Manager, ReceiveOperation } from "@cashu/coco-core";

import { logger } from "../logger";
import { inFlightReceiveToHistoryEntry } from "./inFlightReceives";

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
 * Merge paginated coco history with the in-flight-receive supplement,
 * deduplicating receives by operationId (so a later finalize from coco
 * history wins), then sorting newest-first.
 *
 * Pure: callers own fetching/caching; this only combines.
 */
export function mergeTransactionSources(input: {
  cocoHistory: readonly HistoryEntry[];
  receiveEntries: readonly HistoryEntry[];
}): HistoryEntry[] {
  const { cocoHistory, receiveEntries } = input;

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

  if (newReceives.length === 0) return [...cocoHistory];
  // Match coco's compareHistoryEntries (createdAt DESC, id DESC): without the
  // id tiebreaker, equal-timestamp rows would order differently depending on
  // whether an in-flight receive happens to be present.
  return [...cocoHistory, ...newReceives].sort((a, b) => {
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
