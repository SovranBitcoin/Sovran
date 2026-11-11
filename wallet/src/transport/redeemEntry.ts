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
   * cut short by a kill or an expired background budget.
   */
  | { kind: "redeeming" }
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
    case "redeeming":
    case "redeemed":
    case "spent":
    case "untrusted-mint":
      return { kind: entry.status };
    default:
      return unknownStatus(entry.status, entry.nextAttemptAt);
  }
}

function waiting(nextAttemptAt: number): MeshRedeemPhase {
  return { kind: "waiting", retryAt: nextAttemptAt > 0 ? nextAttemptAt : null };
}

/**
 * Unreachable by type. At run time, read the way the store's reader reads a
 * status it does not know: still in line, so the token is never given up on.
 */
function unknownStatus(_status: never, nextAttemptAt: number): MeshRedeemPhase {
  return waiting(nextAttemptAt);
}

/** True for an entry in line whose time to be tried has come. */
export function isMeshRedeemDue(phase: MeshRedeemPhase, now: number): boolean {
  return (
    phase.kind === "waiting" && (phase.retryAt === null || phase.retryAt <= now)
  );
}

/** In line, whether or not its time has come, or being received: work the drain still has. */
export function isMeshRedeemInPlay(phase: MeshRedeemPhase): boolean {
  return phase.kind === "waiting" || phase.kind === "redeeming";
}

/** Redeemed or spent: it holds no money and never moves again. */
export function isMeshRedeemSettled(phase: MeshRedeemPhase): boolean {
  return phase.kind === "redeemed" || phase.kind === "spent";
}
