// ---------------------------------------------------------------------------
// Mesh transport — one redeem queue entry
//
// What an entry of the redeem queue is, importable on its own as
// `wallet/redeemEntry`. Dependency-free on purpose: the app saves the queue
// in a store, and the store's schema reads these values without loading the
// payment machine behind `wallet`.
//
// The saved shape is the one older releases wrote: a status string, an
// attempt count and a retry time. `meshRedeemPhase` is the one place that
// decides what those mean together; nothing else compares status strings.
// `MESH_REDEEM_MOVES` is the one place that decides how an entry may change.
// ---------------------------------------------------------------------------

/** Every status an entry is saved with. Saved data: never rename or remove one. */
export const MESH_REDEEM_STATUSES = [
  "pending",
  "redeeming",
  "redeemed",
  "spent",
  "untrusted-mint",
  "failed",
] as const;

export type MeshRedeemStatus = (typeof MESH_REDEEM_STATUSES)[number];

/** Attempts after which a token that keeps failing is no longer retried on its own. */
export const MESH_REDEEM_MAX_ATTEMPTS = 5;

export interface MeshRedeemEntry {
  /** Full encoded cashu token. */
  token: string;
  mintUrl: string;
  /** Sum of proof amounts (mint units). */
  amount: number;
  unit: string;
  status: MeshRedeemStatus;
  attempts: number;
  /** UNIX ms; the drain skips entries whose window hasn't opened. */
  nextAttemptAt: number;
  receivedAt: number;
  lastError?: string;
  /** Mesh peer that sent the drop (drives UI + redeemed-status routing). */
  senderPeerID?: string;
  /** NUT-18 payment id when the token arrived via an issued request. */
  paymentId?: string;
}

/**
 * What a new entry is queued as: in line, or, when the message intake already
 * asked before queueing, held for review or spent. Only a new entry is given
 * one; a writer whose token was queued first by another path leaves that
 * entry as it is.
 */
export type MeshRedeemArrival = Extract<
  MeshRedeemStatus,
  "pending" | "untrusted-mint" | "spent"
>;

/**
 * What can happen to an entry already queued. The drain's moves are named by
 * the status they end in, plus `retry` (an attempt failed and may be tried
 * again, or the attempts ran out). Two moves start from a held entry:
 * `requeue` (the person, or a newly trusted mint, puts it back in line; no
 * other move leads to `pending`) and `held-spent` (the reconcile found its
 * token redeemed by hand).
 */
export type MeshRedeemMove =
  Exclude<MeshRedeemStatus, "pending"> | "retry" | "requeue" | "held-spent";

/**
 * The statuses each move may start from. Any other start is refused: a late
 * answer from an older attempt or probe never overwrites a settled entry, a
 * received token never goes back into line, an entry is put back in line
 * only from being held, and an entry the drain has started is moved only by
 * the drain.
 */
const MESH_REDEEM_MOVES: Record<MeshRedeemMove, readonly MeshRedeemStatus[]> = {
  // The drain starts a receive, or resumes one a kill cut short.
  redeeming: ["pending", "redeeming"],
  // Only the drain, after the receive succeeded. From `spent` too: a token
  // this wallet received is recorded as received, whatever was said of it.
  redeemed: ["redeeming", "spent"],
  // The mint answered the drain's receive that the token is spent.
  spent: ["redeeming"],
  // Only the drain's trust check, before it starts or resumes a receive.
  "untrusted-mint": ["pending", "redeeming"],
  // The mint refused the drain's receive.
  failed: ["redeeming"],
  // The drain's trust check or receive failed in a way worth retrying.
  retry: ["pending", "redeeming"],
  requeue: ["untrusted-mint", "failed"],
  // Only while still held: once it is back in line the drain asks the mint.
  "held-spent": ["untrusted-mint", "failed"],
};

export function canMeshRedeemMove(
  from: MeshRedeemStatus,
  move: MeshRedeemMove,
): boolean {
  return MESH_REDEEM_MOVES[move].includes(from);
}

/** What an entry is, decoded from its saved fields. */
export type MeshRedeemPhase =
  /**
   * In line to be received. `retryAt` is the time a failed attempt set for
   * the next one, or null when none has failed since it was queued or put
   * back in line.
   */
  | { kind: "waiting"; retryAt: number | null }
  /**
   * A receive was started and its end was not recorded: still running, or
   * cut short by a kill or an expired background budget. `retryAt` is the
   * retry time the entry carried when it started (null when none); a receive
   * cut short is resumed once that time has come, as it always was.
   */
  | { kind: "redeeming"; retryAt: number | null }
  /** Received into this wallet. */
  | { kind: "redeemed" }
  /** The mint says its proofs are spent. */
  | { kind: "spent" }
  /** Held: the wallet does not trust its mint. */
  | { kind: "untrusted-mint" }
  /**
   * Held: the mint refused it, or it kept failing until the attempts ran out.
   * Either way only the person can put it back in line.
   */
  | { kind: "failed"; reason: "refused" | "out-of-retries" };

export function meshRedeemPhase(
  entry: Pick<MeshRedeemEntry, "status" | "attempts" | "nextAttemptAt">,
): MeshRedeemPhase {
  switch (entry.status) {
    case "pending":
      return waiting(entry.nextAttemptAt);
    case "redeeming":
      return { kind: "redeeming", retryAt: retryAt(entry.nextAttemptAt) };
    case "failed":
      // Only a retry that ran out sets the count this high; a refusal ends
      // an entry with the count it had.
      return {
        kind: "failed",
        reason:
          entry.attempts >= MESH_REDEEM_MAX_ATTEMPTS
            ? "out-of-retries"
            : "refused",
      };
    case "redeemed":
    case "spent":
    case "untrusted-mint":
      return { kind: entry.status };
    default:
      return unknownStatus(entry.status, entry.nextAttemptAt);
  }
}

function waiting(nextAttemptAt: number): MeshRedeemPhase {
  return { kind: "waiting", retryAt: retryAt(nextAttemptAt) };
}

/** A saved retry time of 0 means none was set. */
function retryAt(nextAttemptAt: number): number | null {
  return nextAttemptAt > 0 ? nextAttemptAt : null;
}

/**
 * Unreachable by type. At run time, read the way the store's reader reads a
 * status it does not know: still in line, so the token is never given up on.
 */
function unknownStatus(_status: never, nextAttemptAt: number): MeshRedeemPhase {
  return waiting(nextAttemptAt);
}

/**
 * True for an entry the drain takes now: in line, or a receive cut short,
 * whose time to be tried has come. A receive still running is taken too; the
 * drain runs one at a time, so it can only be one a drain was cut short in.
 */
export function isMeshRedeemDue(phase: MeshRedeemPhase, now: number): boolean {
  return (
    isMeshRedeemInPlay(phase) &&
    (phase.retryAt === null || phase.retryAt <= now)
  );
}

/** In line, whether or not its time has come, or being received: work the drain still has. */
export function isMeshRedeemInPlay(
  phase: MeshRedeemPhase,
): phase is Extract<MeshRedeemPhase, { kind: "waiting" | "redeeming" }> {
  return phase.kind === "waiting" || phase.kind === "redeeming";
}

/** Redeemed or spent: it holds no money and never moves again. */
export function isMeshRedeemSettled(phase: MeshRedeemPhase): boolean {
  return phase.kind === "redeemed" || phase.kind === "spent";
}
