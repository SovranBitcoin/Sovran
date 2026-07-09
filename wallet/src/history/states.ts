// ---------------------------------------------------------------------------
// History state vocabulary — the ONE owner
// ---------------------------------------------------------------------------
//
// Two vocabularies coexist across coco v2 and the shipped consumer contract:
//
//   contract/legacy  mint: UNPAID/PAID/ISSUED   melt: UNPAID/PENDING/PAID
//                    send/receive: prepared/pending/executing/finalized/rolledBack
//   operation (v2)   mint: pending/executing/finalized/failed
//                    melt: prepared/pending/executing/finalized/rolling_back/rolled_back
//
// Every aliasing table, terminal-failure set, and progression rank lives HERE.
// Before this module the same sets were spelled independently in
// history/normalize.ts, history/timeline.ts (twice), screen-actions/
// createManager.ts, and the app's onchainMelt.ts + design-system mirrors —
// and two of those copies had real bugs (rolled_back published as UNPAID;
// no rank guard against out-of-order live events).

import { logger } from "../logger";

export type TimelineFlow = "mint" | "melt" | "send" | "receive";

const TERMINAL_FAILURE_STATES = new Set([
  "rolledBack",
  "rolled_back",
  "rolling_back",
  "failed",
]);

/** rolledBack | rolled_back | rolling_back | failed — the ONE terminal-failure set. */
export function isTerminalFailureState(
  state: string | null | undefined,
): boolean {
  return typeof state === "string" && TERMINAL_FAILURE_STATES.has(state);
}

// ---------------------------------------------------------------------------
// Contract (list / live-bridge) normalization — the legacy vocabulary
// ---------------------------------------------------------------------------

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
 * Map a v2 operation state to the legacy consumer-contract vocabulary.
 * Legacy states and unknown values pass through unchanged. This is the
 * LIST/bridge contract flavor: mint `failed` maps to UNPAID (see table note);
 * the timeline flavor below keeps `failed` so its failure arm can render.
 */
export function normalizeContractState(flow: TimelineFlow, raw: string): string {
  if (raw === "rolled_back") return "rolledBack";
  if (flow === "mint") return MINT_OP_STATE_TO_LEGACY[raw] ?? raw;
  if (flow === "melt") return MELT_OP_STATE_TO_LEGACY[raw] ?? raw;
  return raw;
}

// ---------------------------------------------------------------------------
// Timeline normalization — keeps failure states renderable
// ---------------------------------------------------------------------------

/** Sentinel the timeline uses for a terminally-failed mint. */
export const MINT_FAILED_STATE = "failed";

const MINT_QUOTE_STATES = new Set(["UNPAID", "PAID", "ISSUED"]);

export function isMintQuoteStateValue(
  value: unknown,
): value is "UNPAID" | "PAID" | "ISSUED" {
  return typeof value === "string" && MINT_QUOTE_STATES.has(value);
}

/**
 * The mint state the TIMELINE should render: operation aliases resolved,
 * `failed` preserved, and — for still-pending operations — the quote row's
 * `remoteState` preferred over the operation state (the quote hears about the
 * payment before the operation advances).
 */
export function normalizeTimelineMintState(
  rawState: string,
  remoteState?: unknown,
): string {
  let timelineState: string;
  let reason: string;
  if (rawState === "finalized") {
    timelineState = "ISSUED";
    reason = "finalized-alias";
  } else if (rawState === "executing") {
    timelineState = "PAID";
    reason = "executing-alias";
  } else if (rawState === "failed") {
    timelineState = MINT_FAILED_STATE;
    reason = "failed-alias";
  } else if (isMintQuoteStateValue(remoteState)) {
    timelineState = remoteState;
    reason = "remote-state";
  } else if (rawState === "pending") {
    timelineState = "UNPAID";
    reason = "pending-alias";
  } else if (isMintQuoteStateValue(rawState)) {
    timelineState = rawState;
    reason = "native-state";
  } else {
    timelineState = rawState;
    reason = "unknown-state";
  }
  logger.debug("history.timeline.mintState.result", {
    rawState,
    remoteState: remoteState ?? null,
    timelineState,
    reason,
  });
  return timelineState;
}

/** The melt-quote state the timeline renders. Unknown values fall to UNPAID. */
export function normalizeTimelineMeltState(
  rawState: string,
): "UNPAID" | "PENDING" | "PAID" {
  if (rawState === "finalized") return "PAID";
  if (rawState === "pending" || rawState === "executing") return "PENDING";
  if (rawState === "PAID" || rawState === "PENDING" || rawState === "UNPAID") {
    return rawState;
  }
  return "UNPAID";
}

// ---------------------------------------------------------------------------
// Progression ranks + the out-of-order reconciler
// ---------------------------------------------------------------------------

/**
 * Rank along each flow's progression, keyed lowercase so BOTH vocabularies
 * resolve. `-1` = unknown. Generalizes the onchain-melt rank table that
 * previously lived in the app.
 */
const STATE_RANKS: Record<TimelineFlow, Record<string, number>> = {
  mint: { unpaid: 0, pending: 0, paid: 1, executing: 1, issued: 2, finalized: 2 },
  melt: { unpaid: 0, prepared: 0, pending: 1, executing: 1, paid: 2, finalized: 2 },
  send: { prepared: 0, pending: 1, finalized: 2 },
  receive: { prepared: 0, pending: 1, executing: 1, finalized: 2 },
};

export function entryStateRank(
  flow: TimelineFlow,
  state: string | null | undefined,
): number {
  if (state == null) return -1;
  const rank = STATE_RANKS[flow][state.toLowerCase()];
  return rank == null ? -1 : rank;
}

/**
 * Reconcile two observations of the same flow's state: the MOST-ADVANCED
 * state wins, and a terminal failure on EITHER side wins outright (a stale
 * row must never hide that the operation was reversed). Ties (and two
 * unknowns) prefer `a`. Direct generalization of the onchain-melt resolver:
 * call as `resolveEntryState(flow, quoteState, entryState)` /
 * `resolveEntryState(flow, updatedState, currentState)`.
 */
export function resolveEntryState(
  flow: TimelineFlow,
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  if (isTerminalFailureState(b)) return b ?? null;
  if (isTerminalFailureState(a)) return a ?? null;

  const rankA = entryStateRank(flow, a);
  const rankB = entryStateRank(flow, b);
  const resolved = rankB > rankA ? b : rankA > rankB ? a : (a ?? b);
  return resolved ?? null;
}

const FLOWS = new Set<TimelineFlow>(["mint", "melt", "send", "receive"]);

export function isTimelineFlow(value: unknown): value is TimelineFlow {
  return typeof value === "string" && FLOWS.has(value as TimelineFlow);
}
