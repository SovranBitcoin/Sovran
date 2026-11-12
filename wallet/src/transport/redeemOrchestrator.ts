// ---------------------------------------------------------------------------
// Mesh transport — auto-redeem orchestrator
//
// Port of sovran-app's nutDropAutoRedeem drain: every `pending` queue entry
// past its backoff window is redeemed through the injected
// `executeAutoRedeem` operation. Persistence stays with the wallet app (the
// queue is a port — the app already has a profile-scoped persisted store);
// colada owns the gates, ordering, error classification, and retry policy.
//
// Gates, in order:
// 1. Manager initialized — never touch the wallet mid-profile-switch.
// 2. Restore settled — receives swap with deterministic counters; redeeming
//    mid-restore desyncs them (injected; defaults to settled).
// 3. Mint trust — coco's receive AUTO-TRUSTS unknown mints. Without this
//    gate a hostile mesh payload could inject an arbitrary mint into the
//    wallet. Untrusted-mint entries park for manual review. (Locked sends
//    can't reach this state — the creq allowlist filters pre-send — but the
//    public-broadcast bearer path and hostile senders can.)
// ---------------------------------------------------------------------------

import type { Manager } from "@cashu/coco-core";
import { NetworkError, HttpResponseError } from "@cashu/coco-core";
import { logger, mintUrlFields } from "../logger";
import {
  isMeshRedeemDue,
  meshRedeemPhase,
  type MeshRedeemEntry,
  type MeshRedeemStatus,
} from "./redeemEntry";

/**
 * Persistence port over the wallet's redeem-queue store. Keys are the
 * token dedupe hash (`meshTokenDedupeKey`).
 */
interface MeshRedeemQueuePort {
  /** Drop expired entries (the store owns its TTL policy). */
  prune(): void;
  entries(): Record<string, MeshRedeemEntry>;
  /**
   * True when recorded. Refused by the store when the entry's status is not
   * one the move may start from.
   */
  markStatus(
    tokenHash: string,
    status: Exclude<MeshRedeemStatus, "pending">,
    error?: string,
  ): boolean;
  /**
   * Exponential backoff + terminal `failed` after max attempts (store-owned
   * policy). Returns the status recorded, or null when refused.
   */
  scheduleRetry(
    tokenHash: string,
    error: string,
  ): Extract<MeshRedeemStatus, "pending" | "failed"> | null;
}

type MeshRedeemErrorKind = "spent" | "network" | "retryable" | "fatal";

/**
 * What the queue recorded for a failed attempt: back in line for another try,
 * spent, or held (refused by the mint, or out of attempts).
 */
type MeshRedeemFailure = "retrying" | "spent" | "failed";

export function classifyMeshRedeemError(err: unknown): MeshRedeemErrorKind {
  const message = err instanceof Error ? err.message : String(err);
  if (/already.{0,8}spent|token.{0,8}spent|11001/i.test(message))
    return "spent";
  if (err instanceof NetworkError) return "network";
  if (err instanceof HttpResponseError && err.status >= 500) return "network";
  if (err instanceof Error && err.name === "MintFetchError") return "network";
  if (/network|timeout|timed out|fetch failed|abort/i.test(message))
    return "network";
  // Manager/keyring races (e.g. key pair not registered yet) — retry later.
  if (/key pair not found/i.test(message)) return "retryable";
  return "fatal";
}

interface MeshRedeemOrchestratorConfig {
  getManager: () => Manager | null;
  queue: MeshRedeemQueuePort;
  /**
   * Redeems one token and resolves with the persisted receive history id
   * (null when it couldn't be resolved). Wire `operations.executeAutoRedeem`
   * here so redeems share the machine's receive semantics.
   */
  executeAutoRedeem: (request: {
    tokenString: string;
    mintUrl: string;
    manager: Manager;
  }) => Promise<{ historyEntryId: string | null }>;
  /** NUT-13 restore settled? Defaults to true (no restore concept). */
  isRestoreSettled?: () => boolean;
  now?: () => number;
  /** Entry began redeeming (app mounts its processing toast here). */
  onRedeeming?: (tokenHash: string, entry: MeshRedeemEntry) => void;
  /**
   * Entry recorded redeemed (push the mesh `redeemed` status + confirm UI
   * here). Not called when the queue refused to record it.
   */
  onRedeemed?: (
    tokenHash: string,
    entry: MeshRedeemEntry,
    historyEntryId: string | null,
  ) => void;
  /**
   * A failed attempt, as the queue recorded it (flip the toast here). Not
   * called when the queue refused to record it.
   */
  onFailed?: (
    tokenHash: string,
    entry: MeshRedeemEntry,
    recorded: MeshRedeemFailure,
    message: string,
  ) => void;
}

export interface MeshRedeemOrchestrator {
  /**
   * Drain due entries. Single-flight: a call made while a drain runs does not
   * start a second one; it asks for one more run after the current one, and
   * resolves when that run settles. Calls during the same run share it.
   */
  drain(): Promise<void>;
}

export function createMeshRedeemOrchestrator(
  config: MeshRedeemOrchestratorConfig,
): MeshRedeemOrchestrator {
  const now = config.now ?? Date.now;
  let running: Promise<void> | null = null;
  let rerun: Promise<void> | null = null;

  // A drop that arrives, or an entry requeued by hand, while a run is in
  // progress is not in that run's `due` snapshot, so it gets a run of its own.
  function drain(): Promise<void> {
    if (!running) {
      running = drainOnce().finally(() => {
        running = null;
      });
      return running;
    }
    rerun ??= running
      .catch(() => undefined)
      .then(() => {
        rerun = null;
        return drain();
      });
    return rerun;
  }

  async function drainOnce(): Promise<void> {
    const manager = config.getManager();
    if (!manager) return;
    if (config.isRestoreSettled && !config.isRestoreSettled()) {
      logger.debug("transport.redeem.waitingForRestore");
      return;
    }

    config.queue.prune();
    const cutoff = now();
    // `redeeming` entries are recovered too: single-flight means they can
    // only exist from a drain interrupted by a crash or an expired
    // background budget. Retrying is safe — a receive that actually
    // completed re-classifies as `spent`. Like a waiting entry, one whose
    // retry time is still to come waits for it.
    const due = Object.entries(config.queue.entries()).filter(([, entry]) =>
      isMeshRedeemDue(meshRedeemPhase(entry), cutoff),
    );
    if (due.length === 0) return;

    logger.info("transport.redeem.drainStart", { dueCount: due.length });

    for (const [tokenHash, entry] of due) {
      // A profile switch swaps the manager (and the profile-scoped queue
      // behind the port) mid-drain. Redeeming a queued token into the NEW
      // profile's wallet would bleed funds across profiles — abort the
      // drain the moment the manager identity changes.
      if (config.getManager() !== manager) {
        logger.warn("transport.redeem.managerChanged");
        return;
      }
      let trusted: boolean;
      try {
        trusted = await manager.mint.isTrustedMint(entry.mintUrl);
      } catch (err) {
        if (config.getManager() !== manager) return;
        config.queue.scheduleRetry(
          tokenHash,
          err instanceof Error ? err.message : String(err),
        );
        continue;
      }
      if (config.getManager() !== manager) return;
      if (!trusted) {
        // Never auto-trust a mint pushed at us over the mesh. The entry
        // stays visible (untrusted-mint) for manual review.
        config.queue.markStatus(tokenHash, "untrusted-mint");
        logger.warn("transport.redeem.untrustedMint", {
          tokenHash: tokenHash.slice(0, 12),
          ...mintUrlFields(entry.mintUrl),
        });
        continue;
      }

      if (!config.queue.markStatus(tokenHash, "redeeming")) {
        // Moved since this run read the queue: no longer this run's to receive.
        refused(tokenHash, "redeeming");
        continue;
      }
      config.onRedeeming?.(tokenHash, entry);
      let historyEntryId: string | null;
      try {
        ({ historyEntryId } = await config.executeAutoRedeem({
          tokenString: entry.token,
          mintUrl: entry.mintUrl,
          manager,
        }));
      } catch (err) {
        if (config.getManager() !== manager) return;
        const message = err instanceof Error ? err.message : String(err);
        const recorded = recordFailure(tokenHash, err, message);
        if (recorded) config.onFailed?.(tokenHash, entry, recorded, message);
        else refused(tokenHash, "failure");
        continue;
      }
      if (config.getManager() !== manager) return;
      if (!config.queue.markStatus(tokenHash, "redeemed")) {
        refused(tokenHash, "redeemed");
        continue;
      }
      logger.info("transport.redeem.success", {
        tokenHash: tokenHash.slice(0, 12),
        amount: entry.amount,
        ...mintUrlFields(entry.mintUrl),
      });
      try {
        config.onRedeemed?.(tokenHash, entry, historyEntryId);
      } catch (err) {
        // The token is received and recorded; the rest of the run goes on.
        logger.warn("transport.redeem.onRedeemedFailed", {
          tokenHash: tokenHash.slice(0, 12),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /** Records a failed receive; returns what was recorded, or null when refused. */
  function recordFailure(
    tokenHash: string,
    err: unknown,
    message: string,
  ): MeshRedeemFailure | null {
    const kind = classifyMeshRedeemError(err);
    logger.warn("transport.redeem.attemptFailed", {
      tokenHash: tokenHash.slice(0, 12),
      kind,
      error: message,
    });
    switch (kind) {
      case "spent":
        // Duplicate delivery race (an equivalent token already redeemed)
        // or the sender reclaimed. Nothing actionable.
        return config.queue.markStatus(tokenHash, "spent", message)
          ? "spent"
          : null;
      case "network":
      case "retryable": {
        const status = config.queue.scheduleRetry(tokenHash, message);
        return status === "pending" ? "retrying" : status;
      }
      case "fatal":
        return config.queue.markStatus(tokenHash, "failed", message)
          ? "failed"
          : null;
    }
  }

  function refused(tokenHash: string, move: string): void {
    logger.warn("transport.redeem.recordRefused", {
      tokenHash: tokenHash.slice(0, 12),
      move,
    });
  }

  return { drain };
}
