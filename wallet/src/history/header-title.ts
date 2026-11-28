// ---------------------------------------------------------------------------
// Transaction header titles — the ONE owner of the screen's own name
// ---------------------------------------------------------------------------
//
// A detail screen is opened twice in a transaction's life: once to make the
// payment, and afterwards from history. Its title used to be a single static
// string per route ("Send Lightning"), so a payment that had already settled
// still told the user to send it, and a re-opened melt to a named person still
// read "Pay Alex". Tense is not decoration here — it is the difference between
// a screen that describes a record and one that looks like it still owes work.
//
// So the title is derived, not written at the call site: rail (what moved the
// money) x phase (where the transaction is), with the person phrasing replacing
// the rail phrasing whenever the transaction names a counterparty. A zap is a
// payment to the post's author and reads exactly like any other payment to a
// person; the zapped post itself is the page's business, not the title's.
//
// Strings live in copy/defaults.ts under `header.*` so every rail and phase is
// spelled once and can be localized; this module only decides WHICH key.

import type { HistoryEntry } from "@cashu/coco-core";

import type { PaymentCopyResolver } from "../copy";
import { logger } from "../logger";
import { isOnchainHistoryEntry } from "./filters";
import {
  isTerminalFailureState,
  meltReversalFailed,
  mintNothingRestored,
} from "./states";
import {
  DEFAULT_PAYMENT_COPY,
  getMintTimelineState,
  mintHistoryEntryExpired,
} from "./timeline/context";
import type { TimelineModel } from "./timeline/types";

/** Which rail carried the money, at the granularity the title names. */
type TransactionHeaderRail =
  | "lightningSend"
  | "onchainSend"
  | "ecashSend"
  | "lightningReceive"
  | "onchainReceive"
  | "ecashReceive"
  | "swap";

/**
 * Where the transaction is, in the only terms a title needs: what the user is
 * about to do, is watching happen, or is reading about afterwards.
 */
type TransactionHeaderPhase =
  | "ready"
  | "inFlight"
  | "settled"
  | "cancelled"
  | "failed"
  | "expired"
  /** Being reversed: the funds are on their way back, not back yet. */
  | "reversing";

/** What a title needs off an entry: its flow, its state, the reason it ended
 *  (`error`) and the mint's last word (`remoteState`, `operationState`), and
 *  (for the rail) the annotations that mark a melt or mint as onchain. */
type EntryLike =
  | {
      type?: unknown;
      state?: unknown;
      metadata?: unknown;
      error?: unknown;
      remoteState?: unknown;
      operationState?: unknown;
    }
  | null
  | undefined;

/** What the timeline concluded about the same entry (`buildTimelineModel`). */
type TimelineVerdict = Pick<TimelineModel, "outcome" | "steps">;

/**
 * Phase per state, per flow — the same word means different things on either
 * side of the wallet. A mint quote's `pending` is "nobody has paid yet"; a
 * melt's is "the payment is out there". Both vocabularies (contract and
 * operation, see `states.ts`) are listed because entries carry either.
 */
const PHASE_BY_STATE: Record<
  string,
  Record<string, TransactionHeaderPhase | undefined>
> = {
  mint: {
    pending: "ready",
    UNPAID: "ready",
    executing: "inFlight",
    PAID: "inFlight",
    finalized: "settled",
    ISSUED: "settled",
  },
  melt: {
    prepared: "ready",
    UNPAID: "ready",
    pending: "inFlight",
    executing: "inFlight",
    PENDING: "inFlight",
    finalized: "settled",
    PAID: "settled",
  },
  send: {
    prepared: "ready",
    pending: "inFlight",
    executing: "inFlight",
    finalized: "settled",
  },
  receive: {
    // A token that has been read but not redeemed: nothing is in the wallet.
    prepared: "ready",
    pending: "inFlight",
    executing: "inFlight",
    finalized: "settled",
  },
  swap: {
    pending: "inFlight",
    executing: "inFlight",
    finalized: "settled",
  },
};

/** Incoming flows take the "Received from" phrasing, never "Paid". */
function isReceiveFlow(type: string): boolean {
  return type === "mint" || type === "receive";
}

export function transactionHeaderRail(
  entry: EntryLike,
): TransactionHeaderRail | undefined {
  const type = String(entry?.type ?? "");
  if (!type) return undefined;
  // `isOnchainHistoryEntry` reads annotations, so it only accepts a full entry.
  const onchain =
    (type === "mint" || type === "melt") &&
    isOnchainHistoryEntry(entry as HistoryEntry);
  switch (type) {
    case "melt":
      return onchain ? "onchainSend" : "lightningSend";
    case "mint":
      return onchain ? "onchainReceive" : "lightningReceive";
    case "send":
      return "ecashSend";
    case "receive":
      return "ecashReceive";
    case "swap":
      return "swap";
    default:
      return undefined;
  }
}

/**
 * Where an ended entry stands, from the entry alone. Rollback is not failure
 * in itself: the funds came back, usually because the user asked, and a
 * title that says "Send failed" over a token the user deliberately reclaimed
 * blames the wallet for doing what it was told. So the reason decides.
 */
function endedPhase(
  type: string,
  state: string,
  error: unknown,
): TransactionHeaderPhase {
  if (state === "rolling_back") return "reversing";
  switch (type) {
    case "melt":
      return meltReversalFailed(state, error) ? "failed" : "cancelled";
    // A receive is only ever rolled back by the mint turning the token down
    // (spent, inactive keyset): nobody cancelled it.
    case "receive":
    case "mint":
      return "failed";
    default:
      return state === "failed" ? "failed" : "cancelled";
  }
}

/** A mint quote's phase, from the same resolved state its timeline reads. */
function mintPhase(entry: EntryLike): TransactionHeaderPhase | undefined {
  const mint = entry as HistoryEntry;
  const mintState = getMintTimelineState(mint);
  if (mintState === "failed") return "failed";
  if (mintState === "ISSUED") {
    return mintNothingRestored(entry?.error) ? "failed" : "settled";
  }
  if (mintState === "PAID") return "inFlight";
  if (mintState === "UNPAID") {
    return mintHistoryEntryExpired(mint as Extract<HistoryEntry, { type: "mint" }>)
      ? "expired"
      : "ready";
  }
  return undefined;
}

/** The phase from the entry alone, for a caller that has no timeline. */
function entryPhase(entry: EntryLike): TransactionHeaderPhase {
  const type = String(entry?.type ?? "");
  const state = String(entry?.state ?? "");
  if (isTerminalFailureState(state)) return endedPhase(type, state, entry?.error);
  if (type === "mint") {
    const phase = mintPhase(entry);
    if (phase) return phase;
  }
  const table = Object.hasOwn(PHASE_BY_STATE, type)
    ? PHASE_BY_STATE[type]
    : undefined;
  const phase =
    table && Object.hasOwn(table, state) ? table[state] : undefined;
  // An unknown state still describes a transaction that EXISTS, so the past
  // tense is the safer half of the guess: it never tells the user to do
  // something the wallet may already have done.
  return phase ?? "settled";
}

/**
 * The phase the timeline's own verdict implies. The timeline has read more
 * than the entry (the quote's expiry, our explorer's count, a cancel tap), so
 * where they differ the timeline is what the screen shows and the title
 * follows it. Only an open timeline still asks the entry whether the user is
 * about to act or watching it happen.
 */
function timelinePhase(
  timeline: TimelineVerdict,
  fromEntry: TransactionHeaderPhase,
): TransactionHeaderPhase {
  const { steps, outcome } = timeline;
  switch (outcome.kind) {
    case "settled":
      return "settled";
    case "expired":
      return "expired";
    case "failed":
    case "already-spent":
      return "failed";
    case "rolled-back":
      return steps.some((step) => step.id === "payment-failed")
        ? "failed"
        : "cancelled";
    case "empty":
      return fromEntry;
    case "pending":
      break;
  }
  const open = steps[steps.length - 1];
  // A state the timeline cannot read: it claims nothing, nor does the title.
  if (!open || open.id === "unknown") return fromEntry;
  if (steps.some((step) => step.id === "cancelling")) return "reversing";
  const working = open.stepType === "current" || open.stepType === "waiting";
  if (fromEntry === "ready") return working ? "inFlight" : "ready";
  if (fromEntry === "inFlight") return "inFlight";
  // The entry reads as ended and the rows do not: a mint that has said PAID
  // before the chain has, or an invoice past expiry by this device's clock
  // but not by the timeline's. Nothing handed over yet is still to be done.
  const finished = steps.filter((step) => step.stepType === "complete").length;
  return !working && finished <= 1 ? "ready" : "inFlight";
}

/**
 * Where the transaction is. Pass the entry's timeline when there is one, so
 * the title and the rows tell one story; without it the entry alone decides.
 */
export function transactionHeaderPhase(
  entry: EntryLike,
  timeline?: TimelineVerdict | null,
): TransactionHeaderPhase {
  const fromEntry = entryPhase(entry);
  return timeline ? timelinePhase(timeline, fromEntry) : fromEntry;
}

/**
 * The title for a rail on its own, for chrome that has no entry to read: a
 * route title on a flow that has not created a transaction yet. Defaults to
 * the `ready` phase, which is the only phase such chrome can be in.
 */
export function railHeaderTitle(
  rail: TransactionHeaderRail,
  phase: TransactionHeaderPhase = "ready",
  paymentCopy: PaymentCopyResolver = DEFAULT_PAYMENT_COPY,
): string {
  return paymentCopy.text(`header.${rail}.${phase}` as const);
}

/**
 * The title for a transaction's detail screen.
 *
 * `counterpartyName` switches the phrasing from the rail to the person — pass
 * the name only when the transaction actually named them (an unresolved pubkey
 * is not a name; see `useTransactionIdentity` on the app side).
 */
export function transactionHeaderTitle(
  entry: EntryLike,
  options: {
    counterpartyName?: string | null;
    paymentCopy?: PaymentCopyResolver;
    /** The timeline drawn for this entry, when the caller has one. */
    timeline?: TimelineVerdict | null;
  } = {},
): string {
  const { counterpartyName, paymentCopy = DEFAULT_PAYMENT_COPY, timeline } = options;
  const rail = transactionHeaderRail(entry);
  const phase = transactionHeaderPhase(entry, timeline);
  const name = counterpartyName?.trim();
  const group = name
    ? isReceiveFlow(String(entry?.type ?? ""))
      ? "receivePerson"
      : "payPerson"
    : rail;
  const title = group
    ? paymentCopy.text(`header.${group}.${phase}` as const, { name })
    : "";
  logger.debug("history.header.title", {
    type: String(entry?.type ?? ""),
    state: String(entry?.state ?? ""),
    rail: rail ?? null,
    phase,
    fromTimeline: !!timeline,
    named: !!name,
    title,
  });
  return title;
}
