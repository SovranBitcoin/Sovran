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
import { isOnchainHistoryEntry, isMintExpired } from "./filters";
import { isTerminalFailureState } from "./states";
import { DEFAULT_PAYMENT_COPY } from "./timeline/context";

/** Which rail carried the money, at the granularity the title names. */
export type TransactionHeaderRail =
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
export type TransactionHeaderPhase =
  | "ready"
  | "inFlight"
  | "settled"
  | "cancelled"
  | "failed"
  | "expired";

/**
 * Rollback is not failure: the funds came back, usually because the user asked.
 * `states.ts` groups it with failure for bucketing, but a title that says
 * "Send failed" over a token the user deliberately reclaimed blames the wallet
 * for doing what it was told.
 */
const CANCELLED_STATES = new Set(["rolledBack", "rolled_back", "rolling_back"]);

/** What a title needs off an entry: its flow, its state, and (for the rail)
 *  the annotations that mark a melt or mint as onchain. */
type EntryLike =
  | { type?: unknown; state?: unknown; metadata?: unknown }
  | null
  | undefined;

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

export function transactionHeaderPhase(
  entry: EntryLike,
): TransactionHeaderPhase {
  const type = String(entry?.type ?? "");
  const state = String(entry?.state ?? "");
  if (CANCELLED_STATES.has(state)) return "cancelled";
  if (isTerminalFailureState(state)) return "failed";
  // Expiry is a mint-quote fact the entry carries; a melt's expiry lives on the
  // quote response, which a detail header does not hold.
  if (type === "mint" && isMintExpired(entry as HistoryEntry)) return "expired";
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
  } = {},
): string {
  const { counterpartyName, paymentCopy = DEFAULT_PAYMENT_COPY } = options;
  const rail = transactionHeaderRail(entry);
  const phase = transactionHeaderPhase(entry);
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
    named: !!name,
    title,
  });
  return title;
}
