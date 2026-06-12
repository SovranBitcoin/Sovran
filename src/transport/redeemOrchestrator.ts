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

import type { Manager } from '@cashu/coco-core';
import { NetworkError, HttpResponseError } from '@cashu/coco-core';
import { logger } from '../logger';

export type MeshRedeemStatus =
  | 'pending'
  | 'redeeming'
  | 'redeemed'
  | 'spent'
  | 'untrusted-mint'
  | 'failed';

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
 * Persistence port over the wallet's redeem-queue store. Keys are the
 * token dedupe hash (`meshTokenDedupeKey`).
 */
export interface MeshRedeemQueuePort {
  /** Drop expired entries (the store owns its TTL policy). */
  prune(): void;
  entries(): Record<string, MeshRedeemEntry>;
  markStatus(tokenHash: string, status: MeshRedeemStatus, error?: string): void;
  /** Exponential backoff + terminal `failed` after max attempts (store-owned policy). */
  scheduleRetry(tokenHash: string, error: string): void;
}

export type MeshRedeemErrorKind = 'spent' | 'network' | 'retryable' | 'fatal';

export function classifyMeshRedeemError(err: unknown): MeshRedeemErrorKind {
  const message = err instanceof Error ? err.message : String(err);
  if (/already.{0,8}spent|token.{0,8}spent|11001/i.test(message)) return 'spent';
  if (err instanceof NetworkError) return 'network';
  if (err instanceof HttpResponseError && err.status >= 500) return 'network';
  if (err instanceof Error && err.name === 'MintFetchError') return 'network';
  if (/network|timeout|timed out|fetch failed|abort/i.test(message)) return 'network';
  // Manager/keyring races (e.g. key pair not registered yet) — retry later.
  if (/key pair not found/i.test(message)) return 'retryable';
  return 'fatal';
}

export interface MeshRedeemOrchestratorConfig {
  getManager: () => Manager | null;
  queue: MeshRedeemQueuePort;
  /**
   * Redeems one token and resolves with the persisted receive history id
   * (null when it couldn't be resolved). Wire `operations.executeAutoRedeem`
   * here so redeems share the machine's receive semantics.
   */
  executeAutoRedeem: (
    tokenString: string,
    mintUrl: string
  ) => Promise<{ historyEntryId: string | null }>;
  /** NUT-13 restore settled? Defaults to true (no restore concept). */
  isRestoreSettled?: () => boolean;
  now?: () => number;
  /** Entry began redeeming (app mounts its processing toast here). */
  onRedeeming?: (tokenHash: string, entry: MeshRedeemEntry) => void;
  /** Entry redeemed (push the mesh `redeemed` status + confirm UI here). */
  onRedeemed?: (
    tokenHash: string,
    entry: MeshRedeemEntry,
    historyEntryId: string | null
  ) => void;
  /** Terminal or retry-scheduled failure (flip the toast here). */
  onFailed?: (
    tokenHash: string,
    entry: MeshRedeemEntry,
    kind: MeshRedeemErrorKind,
    message: string
  ) => void;
}

export interface MeshRedeemOrchestrator {
  /** Drain due entries. Single-flight: overlapping calls return immediately. */
  drain(): Promise<void>;
}

export function createMeshRedeemOrchestrator(
  config: MeshRedeemOrchestratorConfig
): MeshRedeemOrchestrator {
  const now = config.now ?? Date.now;
  let inFlight = false;

  async function drain(): Promise<void> {
    if (inFlight) return;
    const manager = config.getManager();
    if (!manager) return;
    if (config.isRestoreSettled && !config.isRestoreSettled()) {
      logger.debug('transport.redeem.waitingForRestore');
      return;
    }

    inFlight = true;
    try {
      config.queue.prune();
      const cutoff = now();
      const due = Object.entries(config.queue.entries()).filter(
        ([, entry]) => entry.status === 'pending' && entry.nextAttemptAt <= cutoff
      );
      if (due.length === 0) return;

      logger.info('transport.redeem.drainStart', { dueCount: due.length });

      for (const [tokenHash, entry] of due) {
        let trusted: boolean;
        try {
          trusted = await manager.mint.isTrustedMint(entry.mintUrl);
        } catch (err) {
          config.queue.scheduleRetry(
            tokenHash,
            err instanceof Error ? err.message : String(err)
          );
          continue;
        }
        if (!trusted) {
          // Never auto-trust a mint pushed at us over the mesh. The entry
          // stays visible (untrusted-mint) for manual review.
          config.queue.markStatus(tokenHash, 'untrusted-mint');
          logger.warn('transport.redeem.untrustedMint', {
            tokenHash: tokenHash.slice(0, 12),
            mintUrl: entry.mintUrl,
          });
          continue;
        }

        config.queue.markStatus(tokenHash, 'redeeming');
        config.onRedeeming?.(tokenHash, entry);
        try {
          const { historyEntryId } = await config.executeAutoRedeem(entry.token, entry.mintUrl);
          config.queue.markStatus(tokenHash, 'redeemed');
          logger.info('transport.redeem.success', {
            tokenHash: tokenHash.slice(0, 12),
            amount: entry.amount,
            mintUrl: entry.mintUrl,
          });
          config.onRedeemed?.(tokenHash, entry, historyEntryId);
        } catch (err) {
          const kind = classifyMeshRedeemError(err);
          const message = err instanceof Error ? err.message : String(err);
          logger.warn('transport.redeem.attemptFailed', {
            tokenHash: tokenHash.slice(0, 12),
            kind,
            error: message,
          });
          if (kind === 'spent') {
            // Duplicate delivery race (an equivalent token already redeemed)
            // or the sender reclaimed. Nothing actionable.
            config.queue.markStatus(tokenHash, 'spent', message);
          } else if (kind === 'network' || kind === 'retryable') {
            config.queue.scheduleRetry(tokenHash, message);
          } else {
            config.queue.markStatus(tokenHash, 'failed', message);
          }
          config.onFailed?.(tokenHash, entry, kind, message);
        }
      }
    } finally {
      inFlight = false;
    }
  }

  return { drain };
}
