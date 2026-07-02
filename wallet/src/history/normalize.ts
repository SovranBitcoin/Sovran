// ---------------------------------------------------------------------------
// History read-model state normalization
// ---------------------------------------------------------------------------
//
// coco v2 projects history from operation repositories: operation-backed
// entries carry operation-family states (mint: pending/executing/finalized/
// failed; melt: prepared/pending/finalized; send/receive: rolled_back), while
// `legacy:` entries keep the v1 vocabulary (mint: UNPAID/PAID/ISSUED; melt:
// UNPAID/PENDING/PAID; send/receive: rolledBack). Every colada and app
// consumer (filters, timeline, buckets, presentation) speaks the legacy
// vocabulary, so the read model normalizes ONCE here — downstream code never
// sees both families.

import type { HistoryEntry } from "@cashu/coco-core";

const MINT_OP_STATE_TO_LEGACY: Record<string, string> = {
  // pending = quote created, payment not yet observed.
  pending: "UNPAID",
  // executing = payment observed, proofs being minted.
  executing: "PAID",
  finalized: "ISSUED",
  // Terminal failure has no legacy equivalent; funds never moved, and the
  // timeline's expiry handling renders expired quotes from `expiry` anyway.
  failed: "UNPAID",
};

const MELT_OP_STATE_TO_LEGACY: Record<string, string> = {
  prepared: "UNPAID",
  pending: "PENDING",
  executing: "PENDING",
  finalized: "PAID",
};

/**
 * Map a v2 operation-projected state to the legacy vocabulary. Legacy states
 * (and unknown values) pass through unchanged; returns the same reference
 * when nothing changes.
 */
export function normalizeHistoryEntryState(entry: HistoryEntry): HistoryEntry {
  const state = (entry as { state?: unknown }).state;
  if (typeof state !== "string") return entry;

  let next: string | undefined;
  if (state === "rolled_back") {
    next = "rolledBack";
  } else if (entry.type === "mint") {
    next = MINT_OP_STATE_TO_LEGACY[state];
  } else if (entry.type === "melt") {
    next = MELT_OP_STATE_TO_LEGACY[state];
  }

  if (!next || next === state) return entry;
  return { ...entry, state: next } as HistoryEntry;
}

/**
 * Normalize a page of entries, keeping the array reference when no entry
 * changed (reference stability feeds the React snapshot gates downstream).
 */
export function normalizeHistoryEntries(
  entries: readonly HistoryEntry[],
): HistoryEntry[] {
  let changed = false;
  const out = entries.map((entry) => {
    const normalized = normalizeHistoryEntryState(entry);
    if (normalized !== entry) changed = true;
    return normalized;
  });
  return changed ? out : (entries as HistoryEntry[]);
}
