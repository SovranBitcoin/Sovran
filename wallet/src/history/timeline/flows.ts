// ---------------------------------------------------------------------------
// Flow definitions — pure data
// ---------------------------------------------------------------------------
//
// One FlowDef per flow variant: the ordered EVENTS of the flow plus the
// terminal outcomes that can end it early. Each event carries the two tenses
// it is ever shown in: `active` while it is the one thing being waited on,
// `completed` once it has happened. The engine draws every completed event and
// exactly one open slot, so a flow can only ever gain rows (engine.ts).
//
// `done` predicates are MONOTONE over the resolved state — the engine takes
// the furthest done event, so a later observation arriving first (a confirmed
// transaction before the melt state catches up) still marks everything before
// it as having happened.

import { MintQuoteState, MeltQuoteState } from "@cashu/cashu-ts";

import { isTerminalFailureState, receiveFailedAsSpent } from "../states";
import {
  EXPIRED_STATE,
  FAILED_STATE,
  getOnchainConfirmationInfo,
  meltQuoteExpired,
  mintHistoryEntryExpired,
  onchainPaidStepType,
} from "./context";
import type {
  FlowDef,
  MilestoneDef,
  OutcomeDef,
  TimelineContext,
  TimelineFlowVariant,
} from "./types";

const ROLLING_BACK = "rolling_back";

/** How long a Lightning payment may be in flight before the row says it is
 *  slow. A stuck HTLC can hold a payment until its timelock, which is hours,
 *  and the mint will not release the ecash either way until it resolves. */
const PAYMENT_SLOW_AFTER_MS = 2 * 60_000;
/** Blocks our explorer may run past the mint's requirement before the row
 *  stops assuming the mint is merely a block or two behind us. */
const CREDIT_OVERDUE_BLOCKS = 3;

/** Wording that turns once the entry has sat in its state past `afterMs`. */
function slowAfter(
  ctx: TimelineContext,
  afterMs: number,
): { slow: boolean; recheckAt?: number } {
  // Without a known moment the state began there is nothing to measure from:
  // the entry's creation is when the quote was made, which can be long before
  // the payment was sent.
  if (ctx.since === null) return { slow: false };
  const at = ctx.since + afterMs;
  return ctx.currentTime >= at ? { slow: true } : { slow: false, recheckAt: at };
}

const isRolledBack = (state: string) =>
  state === "rolledBack" || state === "rolled_back";

/** What the entry recorded about why it ended, when it recorded anything. */
const entryError = (ctx: TimelineContext): string | undefined => {
  const error = (ctx.entry as { error?: unknown }).error;
  return typeof error === "string" && error.trim() ? error : undefined;
};

/** When the entry last changed: the only timestamp an ending can honestly
 *  carry. Absent on app-built entries, so the row then shows none. */
const endedAt = (ctx: TimelineContext): { timestamp?: number } => {
  const updatedAt = (ctx.entry as { updatedAt?: unknown }).updatedAt;
  return typeof updatedAt === "number" && updatedAt > ctx.createdAt
    ? { timestamp: updatedAt }
    : {};
};

// ---------------------------------------------------------------------------
// Mint (lightning + onchain deposit)
// ---------------------------------------------------------------------------

const mintPaid = (ctx: TimelineContext) =>
  ctx.mintState === MintQuoteState.PAID ||
  ctx.mintState === MintQuoteState.ISSUED;
const mintIssued = (ctx: TimelineContext) =>
  ctx.mintState === MintQuoteState.ISSUED;
/** coco's own verdict that an issued quote left nothing in the wallet. Matched
 *  on its wording because nothing else marks it, and matched narrowly: a
 *  live entry can still be carrying an error from an attempt that later
 *  succeeded, and any-error-at-all would call that success a failure. */
const mintNothingRestored = (ctx: TimelineContext) =>
  /no proofs could be restored/i.test(entryError(ctx) ?? "");
/** Issued AND in the wallet (see `mintUnrestoredOutcome`). */
const mintCredited = (ctx: TimelineContext) =>
  mintIssued(ctx) && !mintNothingRestored(ctx);

const mintKnown = (ctx: TimelineContext) =>
  ctx.mintState === MintQuoteState.UNPAID ||
  mintPaid(ctx) ||
  ctx.mintState === FAILED_STATE;

/** The mint took the payment before the receive failed. coco keeps the quote's
 *  last remote state on the entry, which is the one witness left. */
const mintFailedAfterPayment = (ctx: TimelineContext) => {
  const remote = (ctx.entry as { remoteState?: unknown }).remoteState;
  return remote === MintQuoteState.PAID || remote === MintQuoteState.ISSUED;
};

const issuedMilestone: MilestoneDef = {
  id: "issued",
  state: MintQuoteState.ISSUED,
  done: mintCredited,
  active: (ctx) => ({
    label: ctx.paymentCopy.text("timeline.mint.issuing.label"),
    info: ctx.paymentCopy.text("timeline.mint.issuing.info"),
  }),
  completed: (ctx) => ({
    label: ctx.copy.RECEIVE_COPY.redeemed.label,
    info: ctx.copy.MINT_COPY.ISSUED.info(ctx.amount),
    ...endedAt(ctx),
  }),
};

// coco can finish a mint with nothing to show for it: the quote was already
// issued and the outputs could not be restored. It records why. A finished
// operation carrying a reason is therefore not a credit.
const mintUnrestoredOutcome = (paidId: string): OutcomeDef => ({
  id: "unrestored",
  kind: "failed",
  when: (ctx) => mintIssued(ctx) && mintNothingRestored(ctx),
  doneThrough: () => paidId,
  row: (ctx) => ({
    state: FAILED_STATE,
    label: ctx.copy.RECEIVE_COPY.rejected.label,
    stepType: "expired",
    info: ctx.paymentCopy.text("timeline.mint.unrestored.info"),
    ...endedAt(ctx),
  }),
});

const mintFailedOutcome = (paidId: string): OutcomeDef => ({
  id: "failed",
  kind: "failed",
  when: (ctx) => ctx.mintState === FAILED_STATE,
  doneThrough: (ctx) => (mintFailedAfterPayment(ctx) ? paidId : null),
  row: (ctx) => ({
    state: FAILED_STATE,
    label: ctx.copy.MINT_COPY.failed.label,
    stepType: "expired",
    info:
      entryError(ctx) ??
      (mintFailedAfterPayment(ctx)
        ? ctx.paymentCopy.text("timeline.mint.failed.afterPaymentInfo")
        : ctx.copy.MINT_COPY.failed.info),
    ...endedAt(ctx),
  }),
});

const lightningMintFlow: FlowDef = {
  variant: "lightning-mint",
  known: mintKnown,
  outcomes: [
    {
      id: "expired",
      kind: "expired",
      // Expiry only ever applies to a still-UNPAID invoice.
      when: (ctx) =>
        ctx.mintState === MintQuoteState.UNPAID &&
        mintHistoryEntryExpired(
          ctx.entry as Extract<typeof ctx.entry, { type: "mint" }>,
          ctx.currentTime,
        ),
      row: (ctx) => ({
        state: EXPIRED_STATE,
        label: ctx.copy.MINT_COPY.expired.label,
        stepType: "expired",
        info: ctx.copy.MINT_COPY.expired.info,
      }),
    },
    mintFailedOutcome("paid"),
    mintUnrestoredOutcome("paid"),
  ],
  milestones: [
    {
      id: "created",
      state: MintQuoteState.UNPAID,
      done: () => true,
      active: (ctx) => ({
        label: ctx.paymentCopy.text("timeline.mint.created.label"),
      }),
      completed: (ctx) => ({
        label: ctx.paymentCopy.text("timeline.mint.created.label"),
        timestamp: ctx.createdAt,
      }),
    },
    {
      id: "paid",
      state: MintQuoteState.PAID,
      done: mintPaid,
      active: (ctx) => ({
        label: ctx.copy.MINT_COPY.UNPAID.label,
        info: ctx.copy.MINT_COPY.UNPAID.info,
        style: "next-pending",
      }),
      completed: (ctx) => ({ label: ctx.copy.MINT_COPY.PAID.label }),
    },
    issuedMilestone,
  ],
};

// An on-chain deposit has two witnesses that disagree about timing: our own
// explorer sees the transaction first and counts its blocks, and the mint only
// credits the quote once it is deep enough. So the chain events (`deposit`,
// `confirmed`) follow the explorer, and anything the mint has already credited
// proves them too.
const depositSeen = (ctx: TimelineContext) =>
  !!ctx.progress?.hasPayment || mintPaid(ctx);
const depositConfirmed = (ctx: TimelineContext) =>
  !!ctx.progress?.isSatisfied || mintPaid(ctx);

/** The mint decides when a deposit is credited, from its own node. Our
 *  explorer's count is a hint about how close that is, and the only way to
 *  notice it is not happening: our count running well past the requirement. */
const creditOverdue = (ctx: TimelineContext) => {
  const progress = ctx.progress;
  const observed = progress?.observedConfirmations;
  return (
    !!progress &&
    progress.isSatisfied &&
    // Only against a depth the MINT published. Against our fallback guess, a
    // mint that simply wants more blocks would be reported to the user as one
    // that lost their money.
    progress.requirementFromMint === true &&
    typeof observed === "number" &&
    observed >= progress.requiredConfirmations + CREDIT_OVERDUE_BLOCKS
  );
};

/** We drew the deposit as seen, and the explorer no longer reports it: the
 *  transaction left the mempool (replaced, evicted or reorganised out). */
const depositDropped = (ctx: TimelineContext) =>
  ctx.doneRowKeys.includes("deposit") && !depositSeen(ctx);

const onchainMintFlow: FlowDef = {
  variant: "onchain-mint",
  known: mintKnown,
  outcomes: [mintFailedOutcome("confirmed"), mintUnrestoredOutcome("confirmed")],
  milestones: [
    {
      id: "created",
      state: MintQuoteState.UNPAID,
      done: () => true,
      active: (ctx) => ({
        label: ctx.paymentCopy.text("timeline.onchain.created.label"),
      }),
      completed: (ctx) => ({
        label: ctx.paymentCopy.text("timeline.onchain.created.label"),
        timestamp: ctx.createdAt,
      }),
    },
    {
      id: "deposit",
      state: MintQuoteState.UNPAID,
      done: depositSeen,
      active: (ctx) => ({
        label: ctx.paymentCopy.text("timeline.onchain.deposit.waitingLabel"),
        info: ctx.copy.MINT_COPY.UNPAID.onchainInfo,
        style: "next-pending",
      }),
      completed: (ctx) => ({
        label: ctx.paymentCopy.text("timeline.onchain.deposit.seenLabel"),
      }),
    },
    {
      id: "confirmed",
      state: MintQuoteState.PAID,
      done: depositConfirmed,
      // Owns the segmented block-confirmation ring, in both tenses, so the
      // ring fills and then stays full rather than vanishing at the last block.
      ring: (ctx) => !!ctx.progress,
      active: (ctx) => {
        if (depositDropped(ctx)) {
          return {
            label: ctx.paymentCopy.text("timeline.onchain.confirmingLabel"),
            info: ctx.paymentCopy.text("timeline.onchain.droppedInfo"),
            style: "waiting",
          };
        }
        return {
          label: ctx.paymentCopy.text("timeline.onchain.confirmingLabel"),
          ...(ctx.progress
            ? { info: getOnchainConfirmationInfo(ctx.progress, ctx.paymentCopy) }
            : {}),
          // Spins from the first block on; before that nothing has moved yet.
          style:
            onchainPaidStepType(ctx.progress) === "current"
              ? "current"
              : "next-pending",
        };
      },
      completed: (ctx) => ({
        label: ctx.paymentCopy.text("timeline.onchain.confirmedLabel"),
      }),
    },
    {
      ...issuedMilestone,
      active: (ctx) =>
        // Deep enough by our count, and the mint has not credited it yet. We
        // are waiting on the mint, not minting: say so rather than spin.
        mintPaid(ctx)
          ? issuedMilestone.active(ctx)
          : !ctx.progress?.isSatisfied
            ? {
                // This slot is open because "Confirmed" was drawn earlier, but
                // our explorer does not say so now: it lost the transaction,
                // or the mint turned out to want more blocks than we assumed.
                // Say only what is still true.
                label: ctx.paymentCopy.text("timeline.onchain.waitingForMint"),
                info: ctx.paymentCopy.text("timeline.onchain.waitingForMintPlainInfo"),
                style: "next-pending",
              }
            : creditOverdue(ctx)
            ? {
                // Our count is well past what the mint asks for and it has
                // still not credited. That is no longer lag. NUT-30 names the
                // two deposits a mint never credits: one below its minimum,
                // and one it first saw after the request expired.
                label: ctx.paymentCopy.text("timeline.onchain.notCredited.label"),
                info: ctx.paymentCopy.text("timeline.onchain.notCredited.info"),
                style: "waiting",
              }
            : {
                label: ctx.paymentCopy.text("timeline.onchain.waitingForMint"),
                info: ctx.paymentCopy.text("timeline.onchain.waitingForMintInfo"),
                style: "next-pending",
              },
    },
  ],
};

// ---------------------------------------------------------------------------
// Melt (lightning send + onchain send)
// ---------------------------------------------------------------------------

const meltSubmitted = (ctx: TimelineContext) =>
  ctx.meltState === MeltQuoteState.PENDING ||
  ctx.meltState === MeltQuoteState.PAID;
const meltPaid = (ctx: TimelineContext) =>
  ctx.meltState === MeltQuoteState.PAID;

/** `rolling_back` is the reversal in flight, not its result. */
const meltReversing = (ctx: TimelineContext) => ctx.state === ROLLING_BACK;
const meltReversed = (ctx: TimelineContext) =>
  ctx.state !== ROLLING_BACK && isTerminalFailureState(ctx.state);

// A reversed melt returns the ecash to the balance. Whether the user backed
// out or the payment failed is not in the state; it is in the reason. The
// wallet writes exactly one reason itself when the user backs out, and coco
// has several for a payment that did not go through ("Recovered: …",
// "Rollback requested by handler", whatever a later version adds). So the
// known thing is the cancellation, and every other reason is a failure:
// guessing the other way round calls a failed payment a choice the user made.
const USER_CANCELLED = /user cancel|rolled back by user/i;
const meltPaymentFailed = (ctx: TimelineContext) => {
  const reason = entryError(ctx);
  return reason !== undefined && !USER_CANCELLED.test(reason);
};

const meltRolledBackOutcome: OutcomeDef = {
  id: "rolled-back",
  kind: "rolled-back",
  when: (ctx) => meltReversed(ctx) && !meltPaymentFailed(ctx),
  row: (ctx) => ({
    state: "rolledBack",
    label: ctx.copy.MELT_COPY.rolledBack.label,
    stepType: "rolled-back",
    info: ctx.copy.MELT_COPY.rolledBack.info,
    ...endedAt(ctx),
  }),
};

// Its own outcome, so the header can tell a failed payment from a
// cancellation without reading the row's wording.
const meltPaymentFailedOutcome: OutcomeDef = {
  id: "payment-failed",
  kind: "rolled-back",
  when: (ctx) => meltReversed(ctx) && meltPaymentFailed(ctx),
  row: (ctx) => ({
    state: "rolledBack",
    label: ctx.paymentCopy.text("timeline.melt.failed.label"),
    stepType: "rolled-back",
    info: ctx.copy.MELT_COPY.rolledBack.info,
    ...endedAt(ctx),
  }),
};

// Expiry only ever applies from a still-UNPAID quote.
const meltExpiredOutcome: OutcomeDef = {
  id: "expired",
  kind: "expired",
  when: (ctx) =>
    !!ctx.meltQuote &&
    ctx.meltState === MeltQuoteState.UNPAID &&
    !meltReversing(ctx) &&
    meltQuoteExpired(ctx.meltQuote, ctx.currentTime),
  row: (ctx) => ({
    state: EXPIRED_STATE,
    label: ctx.copy.MELT_COPY.expired.label,
    stepType: "expired",
    info: ctx.copy.MELT_COPY.expired.info,
  }),
};

const meltCreatedMilestone: MilestoneDef = {
  id: "created",
  state: MeltQuoteState.UNPAID,
  done: () => true,
  active: (ctx) => ({
    label: ctx.paymentCopy.text("timeline.melt.created.label"),
  }),
  completed: (ctx) => ({
    label: ctx.paymentCopy.text("timeline.melt.created.label"),
    timestamp: ctx.createdAt,
  }),
};

const MELT_STATES = new Set([
  "UNPAID",
  "PENDING",
  "PAID",
  "prepared",
  "executing",
  "pending",
  "finalized",
  ROLLING_BACK,
  "rolled_back",
  "rolledBack",
  "failed",
]);
const meltKnown = (ctx: TimelineContext) => MELT_STATES.has(ctx.state);

const lightningMeltFlow: FlowDef = {
  variant: "lightning-melt",
  known: meltKnown,
  reversing: meltReversing,
  outcomes: [meltRolledBackOutcome, meltPaymentFailedOutcome, meltExpiredOutcome],
  milestones: [
    meltCreatedMilestone,
    {
      id: "submitted",
      state: MeltQuoteState.UNPAID,
      done: meltSubmitted,
      active: (ctx) => ({
        label: ctx.copy.MELT_COPY.UNPAID.label,
        info: ctx.copy.MELT_COPY.UNPAID.info,
        style: "next-pending",
      }),
      completed: (ctx) => ({
        label: ctx.paymentCopy.text("timeline.melt.submitted.label"),
      }),
    },
    {
      id: "paid",
      state: MeltQuoteState.PAID,
      done: meltPaid,
      active: (ctx) => {
        const { slow, recheckAt } = slowAfter(ctx, PAYMENT_SLOW_AFTER_MS);
        return slow
          ? {
              label: ctx.copy.MELT_COPY.PENDING.label,
              info: ctx.paymentCopy.text("timeline.melt.pending.slowInfo"),
              style: "waiting",
            }
          : {
              label: ctx.copy.MELT_COPY.PENDING.label,
              info: ctx.copy.MELT_COPY.PENDING.info,
              ...(recheckAt !== undefined ? { recheckAt } : {}),
            };
      },
      completed: (ctx) => ({
        label: ctx.copy.MELT_COPY.PAID.label,
        info: ctx.copy.MELT_COPY.PAID.info,
        ...endedAt(ctx),
      }),
    },
  ],
};

// Onchain send (NUT-30). The mint's own state stays PENDING from "accepted"
// through "confirmed", so the network phase is read off our explorer instead:
// the transaction appearing is `broadcast`, its depth is `confirmed`.
//
// The two are separate observers and do not agree on timing. Our explorer can
// count the last block before the mint marks the quote PAID, and the mint can
// mark it PAID while our explorer is still a few blocks behind (a different
// node, a different threshold, or simply lag). Either one saying "deep
// enough" is the event; the timeline never waits for the slower of the two.
const onchainBroadcast = (ctx: TimelineContext) => !!ctx.progress?.hasPayment;
// "Confirmed" ends the payment, so it is the mint's to say: PAID, for a
// transaction we can see. Our own count reaching the depth does not finish
// it — the transaction we are counting may be a heuristic match, and the mint
// can still reverse a melt it has not settled. (PAID with nothing on the
// explorer is not this either: that is an off-chain settle, or one still
// being told apart from it.)
const onchainConfirmed = (ctx: TimelineContext) =>
  meltPaid(ctx) && onchainBroadcast(ctx);
/** Deep enough by our own count, and the mint has not said PAID yet. */
const onchainDeepByOurCount = (ctx: TimelineContext) =>
  !!ctx.progress?.isSatisfied && !meltPaid(ctx);
// The mint accepted the melt (the ecash has left the wallet). True past
// UNPAID, and also whenever anything later has been observed: keying on the
// melt-state string alone left this row waiting under a finished network
// phase when a mint reported a settled state the mapping did not recognise.
const onchainSubmitted = (ctx: TimelineContext) =>
  meltSubmitted(ctx) ||
  onchainBroadcast(ctx) ||
  onchainConfirmed(ctx) ||
  !!ctx.onchainSettledInternally;

const broadcastDropped = (ctx: TimelineContext) =>
  ctx.doneRowKeys.includes("broadcast") && !onchainBroadcast(ctx);

const onchainMeltFlow: FlowDef = {
  variant: "onchain-melt",
  // An unreadable state is still a known payment once the chain or the mint's
  // settlement has been observed for it.
  known: (ctx) =>
    meltKnown(ctx) || onchainBroadcast(ctx) || !!ctx.onchainSettledInternally,
  reversing: meltReversing,
  outcomes: [
    meltRolledBackOutcome,
    meltPaymentFailedOutcome,
    meltExpiredOutcome,
    // PAID with no outpoint: the mint paid without a transaction, so there is
    // no network phase to wait through. Lands in the slot that was waiting
    // for the broadcast.
    {
      id: "settled-offchain",
      kind: "settled",
      // The verdict is an inference from an absent outpoint, so a transaction
      // we have seen (now, or earlier on this card) outranks it.
      when: (ctx) =>
        !!ctx.onchainSettledInternally &&
        !onchainBroadcast(ctx) &&
        !ctx.doneRowKeys.includes("broadcast"),
      doneThrough: () => "submitted",
      row: (ctx) => ({
        state: MeltQuoteState.PAID,
        // Says what the mint said, and no more: PAID is the mint's word and
        // is final; "no transaction" is what its answer left out.
        label: ctx.paymentCopy.text("timeline.melt.onchain.settling.label"),
        stepType: "success",
        info: ctx.copy.MELT_COPY.onchain.offchain.info,
        ...endedAt(ctx),
      }),
    },
  ],
  milestones: [
    meltCreatedMilestone,
    {
      // The timeline only exists once the user taps Pay, so this slot spins
      // from the start rather than waiting on a tap.
      id: "submitted",
      state: MeltQuoteState.UNPAID,
      done: onchainSubmitted,
      active: (ctx) => ({
        label: ctx.copy.MELT_COPY.onchain.sending.label,
        info: ctx.copy.MELT_COPY.onchain.sending.info,
      }),
      completed: (ctx) => ({
        label: ctx.paymentCopy.text("timeline.melt.submitted.label"),
      }),
    },
    {
      id: "broadcast",
      state: MeltQuoteState.PENDING,
      done: onchainBroadcast,
      active: (ctx) =>
        // PAID, and nothing on the explorer yet: the mint is done, and whether
        // there is a transaction to find is still being told apart from an
        // off-chain settle. "Broadcasting" would be a claim about a
        // transaction that may not exist.
        meltPaid(ctx)
          ? {
              label: ctx.paymentCopy.text("timeline.melt.onchain.settling.label"),
              info: ctx.paymentCopy.text("timeline.melt.onchain.settling.info"),
            }
          : {
              label: ctx.copy.MELT_COPY.onchain.broadcasting.label,
              info: ctx.copy.MELT_COPY.onchain.broadcasting.info,
            },
      completed: (ctx) => ({
        label: ctx.paymentCopy.text("timeline.melt.onchain.broadcast.label"),
      }),
    },
    {
      id: "confirmed",
      state: MeltQuoteState.PAID,
      done: onchainConfirmed,
      ring: (ctx) => !!ctx.progress,
      active: (ctx) => {
        const progress = ctx.progress;
        if (broadcastDropped(ctx)) {
          return {
            label: ctx.copy.MELT_COPY.onchain.mempool.label,
            info: ctx.paymentCopy.text("timeline.onchain.droppedInfo"),
            style: "waiting",
          };
        }
        if (onchainDeepByOurCount(ctx)) {
          return {
            label: ctx.paymentCopy.text("timeline.melt.onchain.awaitingMint.label"),
            info: ctx.paymentCopy.text("timeline.melt.onchain.awaitingMint.info"),
            style: "next-pending",
          };
        }
        return {
          // In the mempool until the first block, counting blocks after it.
          label:
            (progress?.currentConfirmations ?? 0) >= 1
              ? ctx.paymentCopy.text("timeline.melt.onchain.confirming.label")
              : ctx.copy.MELT_COPY.onchain.mempool.label,
          ...(progress
            ? {
                info: ctx.paymentCopy.text("timeline.melt.onchain.blocks", {
                  current: String(progress.currentConfirmations ?? 0),
                  required: String(progress.requiredConfirmations),
                }),
              }
            : {}),
        };
      },
      completed: (ctx) => ({
        label: ctx.copy.MELT_COPY.onchain.confirmed.label,
        ...endedAt(ctx),
      }),
    },
  ],
};

// ---------------------------------------------------------------------------
// Send (bearer ecash)
// ---------------------------------------------------------------------------

const SEND_STATES = new Set([
  "prepared",
  "executing",
  "pending",
  "finalized",
  ROLLING_BACK,
  "rolledBack",
  "rolled_back",
]);
const sendKnown = (ctx: TimelineContext) => SEND_STATES.has(ctx.state);
const sendReversing = (ctx: TimelineContext) => ctx.state === ROLLING_BACK;

/** coco attaches the token at execute, so its presence proves one was made —
 *  the one thing a rolled-back send still says about how far it got. */
const sendHasToken = (ctx: TimelineContext) =>
  !!(ctx.entry as { token?: unknown }).token;
const sendTokenCreated = (ctx: TimelineContext) =>
  ctx.state === "pending" || ctx.state === "finalized" || sendHasToken(ctx);

const sendCreatedMilestone: MilestoneDef = {
  id: "created",
  state: "prepared",
  done: sendTokenCreated,
  active: (ctx) => ({
    label: ctx.paymentCopy.text("timeline.send.creating.label"),
    info: ctx.paymentCopy.text("timeline.send.creating.info"),
  }),
  completed: (ctx) => ({
    label: ctx.copy.SEND_COPY.prepared.label,
    timestamp: ctx.createdAt,
  }),
};

const sendClaimedCompleted: MilestoneDef["completed"] = (ctx) => ({
  label: ctx.copy.SEND_COPY.finalized.label,
  info: ctx.copy.SEND_COPY.finalized.info,
  ...endedAt(ctx),
});

const sendRolledBackRow = (
  ctx: TimelineContext,
  label: string,
): ReturnType<OutcomeDef["row"]> => ({
  state: "rolledBack",
  label,
  stepType: "rolled-back",
  info: ctx.copy.SEND_COPY.rolledBack.info,
  ...endedAt(ctx),
});

const sendFlow: FlowDef = {
  variant: "send",
  known: sendKnown,
  reversing: sendReversing,
  outcomes: [
    {
      id: "rolled-back",
      kind: "rolled-back",
      when: (ctx) => isRolledBack(ctx.state),
      row: (ctx) => sendRolledBackRow(ctx, ctx.copy.SEND_COPY.rolledBack.label),
    },
  ],
  milestones: [
    sendCreatedMilestone,
    {
      id: "claimed",
      state: "pending",
      done: (ctx) => ctx.state === "finalized",
      active: (ctx) => ({
        label: ctx.copy.SEND_COPY.pending.label,
        info: ctx.copy.SEND_COPY.pending.info,
        style: "next-pending",
      }),
      completed: sendClaimedCompleted,
    },
  ],
};

// A send locked to somebody. Its own flow rather than conditionals inside
// `sendFlow`: there is one more event (the lock opening) and it is a clock
// event, so it can happen, or never happen, independently of the claim.
//
// That independence is why claiming is an OUTCOME here and not the last
// event. As an event, a send claimed before its locktime would have to mark
// "Unlocked" as happened to reach "Claimed" — a moment that never occurred.

const lockOpen = (ctx: TimelineContext) =>
  ctx.lock?.reclaim.kind === "now" ||
  (ctx.lock?.reclaim.kind !== "at" &&
    ctx.lock?.unlockAt != null &&
    ctx.currentTime >= ctx.lock.unlockAt);

/** The send ended after its lock had opened. The clock keeps running after a
 *  send ends, so an ended send is judged by when it ended, not by now. */
function endedAfterUnlock(ctx: TimelineContext): boolean {
  const updatedAt = (ctx.entry as { updatedAt?: unknown }).updatedAt;
  return (
    ctx.lock?.unlockAt != null &&
    typeof updatedAt === "number" &&
    updatedAt >= ctx.lock.unlockAt
  );
}

/** Who the lock opens to, said from the lock's own terms rather than from
 *  what this wallet happens to be able to sign. */
const lockOpensTo = (ctx: TimelineContext) =>
  ctx.lock?.refund == null
    ? ctx.copy.SEND_COPY.unlock.infoPublic
    : ctx.paymentCopy.text("timeline.send.unlock.infoRefundSignatures");

const lockedSendEnded = (ctx: TimelineContext) =>
  ctx.state === "finalized" || isRolledBack(ctx.state);

const lockedSendFlow: FlowDef = {
  variant: "locked-send",
  known: sendKnown,
  reversing: sendReversing,
  outcomes: [
    {
      id: "rolled-back",
      kind: "rolled-back",
      when: (ctx) => isRolledBack(ctx.state),
      doneThrough: (ctx) => (endedAfterUnlock(ctx) ? "unlock" : null),
      row: (ctx) =>
        sendRolledBackRow(
          ctx,
          endedAfterUnlock(ctx)
            ? ctx.copy.SEND_COPY.rolledBack.reclaimedLabel
            : ctx.copy.SEND_COPY.rolledBack.label,
        ),
    },
    {
      id: "claimed",
      kind: "settled",
      when: (ctx) => ctx.state === "finalized",
      doneThrough: (ctx) => (endedAfterUnlock(ctx) ? "unlock" : "created"),
      row: (ctx) => ({
        state: "finalized",
        stepType: "success",
        ...sendClaimedCompleted(ctx),
      }),
    },
  ],
  milestones: [
    sendCreatedMilestone,
    {
      id: "unlock",
      state: "pending",
      included: (ctx) => ctx.lock?.unlockAt != null,
      done: (ctx) => !lockedSendEnded(ctx) && lockOpen(ctx),
      active: (ctx) => ({
        label: ctx.copy.SEND_COPY.locked.label,
        // An ABSOLUTE date on the row, because it rebuilds only at the
        // boundary: a live "in 3 hours" would be wrong for the next three.
        info:
          ctx.lock?.reclaim.kind === "at"
            ? ctx.copy.SEND_COPY.unlock.infoUpcoming
            : lockOpensTo(ctx),
        style: "next-pending",
        ...(ctx.lock?.unlockAt != null ? { timestamp: ctx.lock.unlockAt } : {}),
      }),
      completed: (ctx) => ({
        label: ctx.copy.SEND_COPY.unlock.reachedLabel,
        ...(ctx.lock?.unlockAt != null ? { timestamp: ctx.lock.unlockAt } : {}),
      }),
    },
    {
      id: "claimed",
      state: "pending",
      // Only the outcome above ends this slot.
      done: () => false,
      active: (ctx) => {
        const reclaim = ctx.lock?.reclaim;
        if (reclaim?.kind === "now") {
          // Who can take it, now that it is open. A lock with no refund tag
          // opens to whoever holds the token, not to us.
          return reclaim.via === "refund"
            ? {
                label: ctx.copy.SEND_COPY.unlock.label,
                info: ctx.copy.SEND_COPY.unlock.infoRefund,
                style: "next-pending",
              }
            : {
                label: ctx.copy.SEND_COPY.pending.label,
                info: ctx.copy.SEND_COPY.unlock.infoPublic,
                style: "next-pending",
              };
        }
        if (ctx.lock?.unlockAt != null && lockOpen(ctx)) {
          // Open, but not to a key this wallet can sign with on its own.
          return {
            label: ctx.copy.SEND_COPY.pending.label,
            info: lockOpensTo(ctx),
            style: "next-pending",
          };
        }
        return {
          label: ctx.copy.SEND_COPY.locked.label,
          info: ctx.copy.SEND_COPY.locked.info,
          style: "next-pending",
        };
      },
      completed: sendClaimedCompleted,
    },
  ],
};

// ---------------------------------------------------------------------------
// Payment-request send (outgoing "pay this request" ecash)
// ---------------------------------------------------------------------------

const prSendCreated = (ctx: TimelineContext) =>
  !!ctx.tokenCreated || sendTokenCreated(ctx);
const prSendDelivered = (ctx: TimelineContext) =>
  ctx.state === "finalized" || !!ctx.nostrSent;

const paymentRequestSendFlow: FlowDef = {
  variant: "payment-request-send",
  known: sendKnown,
  reversing: sendReversing,
  outcomes: [
    {
      id: "rolled-back",
      kind: "rolled-back",
      when: (ctx) => isRolledBack(ctx.state),
      doneThrough: (ctx) =>
        ctx.nostrSent ? "delivered" : ctx.tokenCreated ? "created" : null,
      row: (ctx) => ({
        state: "rolledBack",
        label: ctx.copy.PAYMENT_REQUEST_COPY.rolledBack.label,
        stepType: "rolled-back",
        info: ctx.copy.PAYMENT_REQUEST_COPY.rolledBack.info,
        ...endedAt(ctx),
      }),
    },
  ],
  milestones: [
    {
      ...sendCreatedMilestone,
      done: prSendCreated,
      active: (ctx) =>
        // Still a preview: the user has not confirmed, so nothing is being
        // built. A spinner here would say work is under way.
        ctx.preview
          ? {
              label: ctx.paymentCopy.text("timeline.paymentRequest.ready.label"),
              info: ctx.paymentCopy.text("timeline.paymentRequest.ready.info"),
              style: "next-pending",
            }
          : sendCreatedMilestone.active(ctx),
    },
    {
      id: "delivered",
      state: "nostrSent",
      done: prSendDelivered,
      active: (ctx) => ({
        label: ctx.paymentCopy.text("timeline.paymentRequest.delivering.label"),
        info: ctx.paymentCopy.text("timeline.paymentRequest.delivering.info"),
      }),
      completed: (ctx) => ({
        label: ctx.copy.PAYMENT_REQUEST_COPY.nostrSent.label,
        info:
          ctx.requestTransport === "nostr"
            ? ctx.paymentCopy.text("timeline.paymentRequest.delivered.nostrInfo")
            : ctx.requestTransport === "http"
              ? ctx.paymentCopy.text("timeline.paymentRequest.delivered.httpInfo")
              : ctx.copy.PAYMENT_REQUEST_COPY.nostrSent.infoSent,
      }),
    },
    {
      id: "claimed",
      state: "finalized",
      done: (ctx) => ctx.state === "finalized",
      active: (ctx) => ({
        label: ctx.copy.SEND_COPY.pending.label,
        info: ctx.copy.SEND_COPY.pending.info,
        style: "next-pending",
      }),
      completed: (ctx) => ({
        label: ctx.copy.PAYMENT_REQUEST_COPY.finalized.label,
        info: ctx.copy.PAYMENT_REQUEST_COPY.finalized.info,
        ...endedAt(ctx),
      }),
    },
  ],
};

// ---------------------------------------------------------------------------
// Receive (token redemption)
// ---------------------------------------------------------------------------

/**
 * What a rolled-back receive may claim. "Already spent" is a statement about
 * someone else's action, so it needs the mint to have said so; every other
 * rejection says only what is known: the token was not added.
 */
const receiveRejectedOutcome = (doneThrough?: string): OutcomeDef => ({
  id: "already-spent",
  kind: "already-spent",
  when: (ctx) => !ctx.prPendingFlag && isRolledBack(ctx.state),
  ...(doneThrough ? { doneThrough: () => doneThrough } : {}),
  row: (ctx) => {
    const { alreadySpent, rejected } = ctx.copy.RECEIVE_COPY;
    const reason = (ctx.entry as { error?: unknown }).error;
    return {
      state: "alreadySpent",
      ...(receiveFailedAsSpent(reason) ? alreadySpent : rejected),
      stepType: "already-spent",
      ...endedAt(ctx),
    };
  },
});

const addedCompleted: MilestoneDef["completed"] = (ctx) => ({
  label: ctx.copy.RECEIVE_COPY.redeemed.label,
  info: ctx.copy.RECEIVE_COPY.redeemed.info(ctx.amount),
  ...endedAt(ctx),
});

const receiveFlow: FlowDef = {
  variant: "receive",
  outcomes: [receiveRejectedOutcome()],
  milestones: [
    {
      id: "received",
      state: "accepted",
      done: () => true,
      active: (ctx) => ({ label: ctx.copy.RECEIVE_COPY.accepted.label }),
      completed: (ctx) => ({
        label: ctx.copy.RECEIVE_COPY.accepted.label,
        timestamp: ctx.createdAt,
      }),
    },
    {
      id: "added",
      state: "redeemed",
      // Only a finalized receive has added anything. A state this flow does
      // not know (a newer coco, a corrupt row) stays open: claiming "Added to
      // wallet" for it would be inventing a credit.
      done: (ctx) => ctx.state === "finalized",
      active: (ctx) =>
        // `executing` is a token accepted but not yet redeemed (taken while
        // the mint was unreachable): the same slot, stalled.
        ctx.state === "executing"
          ? {
              label: ctx.copy.RECEIVE_COPY.waiting.label,
              info: ctx.copy.RECEIVE_COPY.waiting.info,
              style: "waiting",
            }
          : {
              label: ctx.copy.RECEIVE_COPY.pending.label,
              info: ctx.copy.RECEIVE_COPY.pending.info,
              style: "next-pending",
            },
      completed: addedCompleted,
    },
  ],
};

// ---------------------------------------------------------------------------
// Payment-request receive (incoming "Fixed Amount → as Ecash")
// ---------------------------------------------------------------------------
//
// Leads with the step a plain token receive lacks: waiting for the payer. The
// list's pending row is `state:executing` + paymentRequestPending and must
// ALWAYS read "waiting for payment", never "redeeming", so the pending flag
// pins the flow to that slot regardless of state.

const prReceivePaid = (ctx: TimelineContext) => !ctx.prPendingFlag;

const paymentRequestReceiveFlow: FlowDef = {
  variant: "payment-request-receive",
  outcomes: [receiveRejectedOutcome("paid")],
  milestones: [
    {
      id: "requested",
      state: "requested",
      done: () => true,
      active: (ctx) => ({
        label: ctx.copy.RECEIVE_COPY.paymentRequest.requested.label,
      }),
      completed: (ctx) => ({
        label: ctx.copy.RECEIVE_COPY.paymentRequest.requested.label,
        timestamp: ctx.createdAt,
      }),
    },
    {
      id: "paid",
      state: "paid",
      done: prReceivePaid,
      active: (ctx) => ({
        label: ctx.copy.MINT_COPY.UNPAID.label,
        info: ctx.copy.RECEIVE_COPY.paymentRequest.requested.info,
        style: "next-pending",
      }),
      completed: (ctx) => ({
        label: ctx.copy.RECEIVE_COPY.paymentRequest.paid.label,
      }),
    },
    {
      id: "added",
      state: "added",
      done: (ctx) => prReceivePaid(ctx) && ctx.state === "finalized",
      active: (ctx) => ({
        label: ctx.paymentCopy.text("timeline.mint.issuing.label"),
        info: ctx.copy.RECEIVE_COPY.paymentRequest.paid.info,
      }),
      completed: addedCompleted,
    },
  ],
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const TIMELINE_FLOWS: Partial<Record<TimelineFlowVariant, FlowDef>> = {
  "lightning-mint": lightningMintFlow,
  "onchain-mint": onchainMintFlow,
  "lightning-melt": lightningMeltFlow,
  "onchain-melt": onchainMeltFlow,
  send: sendFlow,
  "locked-send": lockedSendFlow,
  "payment-request-send": paymentRequestSendFlow,
  receive: receiveFlow,
  "payment-request-receive": paymentRequestReceiveFlow,
};
