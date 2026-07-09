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
import { isTimelineFlow, normalizeContractState } from "./states";

/**
 * Map a v2 operation-projected state to the legacy vocabulary. Legacy states
 * (and unknown values) pass through unchanged; returns the same reference
 * when nothing changes. The aliasing tables live in history/states.ts — the
 * one owner of state vocabulary.
 */
export function normalizeHistoryEntryState(entry: HistoryEntry): HistoryEntry {
  const state = (entry as { state?: unknown }).state;
  if (typeof state !== "string") return entry;
  if (!isTimelineFlow(entry.type)) return entry;

  const next = normalizeContractState(entry.type, state);
  if (next === state) return entry;
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
 * Normalize a coco-read entry into colada's in-memory history contract: legacy
 * state vocabulary AND a PLAIN NUMERIC amount. coco v2 entries carry `amount`
 * as an `Amount` OBJECT (`{ toNumber() }`), not a number — screen-actions
 * matching (`shouldApplyEntryUpdate`'s preview `mintUrl + amount` fallback)
 * compares amounts by strict numeric equality, so an object amount silently
 * fails every match and live updates get dropped. Run this at every boundary
 * where a raw coco entry crosses into consumer/contract code (the live
 * screen-actions bridge as well as the transaction-list read model). Returns
 * the same reference when nothing changed.
 */
export function normalizeHistoryEntry(entry: HistoryEntry): HistoryEntry {
  const stateNormalized = normalizeHistoryEntryState(entry);
  const rawAmount = (stateNormalized as { amount?: AmountLike }).amount;
  const numericAmount = amountToNumber(rawAmount);
  if (rawAmount === numericAmount) return stateNormalized;
  // coco types `amount` as an `Amount` object; we deliberately downcast to a
  // plain number at this contract boundary (consumers read via amountToNumber).
  return {
    ...stateNormalized,
    amount: numericAmount,
  } as unknown as HistoryEntry;
}

/**
 * Serialize an entry into colada's JSON history contract: legacy state
 * vocabulary and a PLAIN NUMERIC amount (a live cashu-ts Amount would
 * stringify to a quoted string). Use this instead of raw JSON.stringify
 * whenever a coco-read entry crosses into the serialized contract.
 */
export function serializeHistoryEntry(entry: HistoryEntry): string {
  return JSON.stringify(normalizeHistoryEntry(entry));
}
