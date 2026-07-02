// ---------------------------------------------------------------------------
// History read-model state normalization
// ---------------------------------------------------------------------------
//
// coco v2 projects history from operation repositories: operation-backed
// entries carry operation-family states (mint: pending/executing/finalized/
// failed; melt: prepared/pending/finalized; send/receive: rolled_back), while
// `legacy:` entries keep the v1 vocabulary (mint: UNPAID/PAID/ISSUED; melt:
// UNPAID/PENDING/PAID; send/receive: rolledBack). Consumers speak the legacy
// vocabulary, so `useColadaTransactions.fetchPage` — the transaction-list
// read model — normalizes there. NOTE the boundary is that hook, not the
// coco API: code that calls `getPaginatedHistory` directly (balance pending
// sums, sovranPaymentConfig polling) still sees raw v2 states and must not
// branch on the legacy vocabulary without normalizing first (today those
// readers only match states both families share).

import type { HistoryEntry } from "@cashu/coco-core";

import { amountToNumber, type AmountLike } from "../amount";

const MINT_OP_STATE_TO_LEGACY: Record<string, string> = {
  // pending = quote created, payment not yet observed.
  pending: "UNPAID",
  // executing = payment observed, proofs being minted.
  executing: "PAID",
  finalized: "ISSUED",
  // Conscious v1 compromise: terminal failure has no legacy equivalent, so a
  // mint quote that fails BEFORE expiry renders as still-waiting. Funds never
  // moved, and the timeline's expiry handling covers the common timeout case.
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

/**
 * Serialize an entry into colada's JSON history contract: legacy state
 * vocabulary and a PLAIN NUMERIC amount (a live cashu-ts Amount would
 * stringify to a quoted string). Use this instead of raw JSON.stringify
 * whenever a coco-read entry crosses into the serialized contract.
 */
export function serializeHistoryEntry(entry: HistoryEntry): string {
  const normalized = normalizeHistoryEntryState(entry);
  return JSON.stringify({
    ...normalized,
    amount: amountToNumber((normalized as { amount?: AmountLike }).amount),
  });
}
