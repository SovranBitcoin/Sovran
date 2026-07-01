// ---------------------------------------------------------------------------
// WalletContextTracker — maintains a live WalletContext from Manager events
//
// Subscribes to Manager events (proofs, mints) and maintains an up-to-date
// WalletContext. Framework-agnostic — no React dependency.
// ---------------------------------------------------------------------------

import type { CoreProof, Manager } from '@cashu/coco-core';
import { amountToNumber } from '../amount';
import { errField, logger, mintUrlFields } from '../logger';
import { deriveMintMethodCapabilityMapFromTrustedMints } from '../mint-capabilities';
import type { WalletContext } from '../types';

// Reach past coco's `private` ProofService to get the ready (UNSPENT,
// unreserved) proofs for one mint. The public surface only exposes balance
// totals; the tracker needs the per-proof amount distribution to drive
// offline-amount composition. Cast lives here because the tracker is the
// only intra-package consumer; sovran-side reach-ins live in
// sovran-app/shared/lib/cashu/managerInternals.ts.
function getReadyProofs(
  manager: Manager,
  mintUrl: string,
): Promise<CoreProof[]> {
  return (
    manager as unknown as {
      proofService: { getReadyProofs(mintUrl: string): Promise<CoreProof[]> };
    }
  ).proofService.getReadyProofs(mintUrl);
}

interface WalletContextTrackerConfig {
  getPreferredMintUrl?: () => string | undefined;
}

type TrustedMint = Awaited<
  ReturnType<Manager['mint']['getAllTrustedMints']>
>[number];
type ManagerEventName = Parameters<Manager['on']>[0];

export interface WalletContextTracker {
  getContext: () => WalletContext;
  subscribe: (listener: () => void) => () => void;
  refresh: () => Promise<void>;
  dispose: () => void;
}

// After this many consecutive top-level refresh failures we stop scheduling
// the next retry. The tracker stays alive (so a future Manager event can
// reset the counter and resume), but a poisoned state — disposed manager,
// gone DB — no longer spins the JS thread or floods logs.
const MAX_CONSECUTIVE_REFRESH_FAILURES = 5;

function countReadyProofs(proofAmounts: Record<string, number[]>): number {
  return Object.values(proofAmounts).reduce(
    (sum, proofs) => sum + proofs.length,
    0,
  );
}

export function createWalletContextTracker(
  manager: Manager,
  config?: WalletContextTrackerConfig,
): WalletContextTracker {
  let trustedMintUrls: string[] = [];
  let mintBalances: Record<string, number> = {};
  let proofAmounts: Record<string, number[]> = {};
  let mintMethodCapabilities: WalletContext['mintMethodCapabilities'] = {};

  const listeners = new Set<() => void>();
  let refreshing = false;
  let pendingRefresh = false;
  let consecutiveFailures = 0;
  let disposed = false;
  let refreshSequence = 0;

  logger.info('walletContextTracker.create', {
    hasPreferredMintGetter: !!config?.getPreferredMintUrl,
    maxConsecutiveRefreshFailures: MAX_CONSECUTIVE_REFRESH_FAILURES,
  });

  function emit() {
    logger.debug('walletContextTracker.emit', {
      listenerCount: listeners.size,
      trustedMintCount: trustedMintUrls.length,
      balanceMintCount: Object.keys(mintBalances).length,
      proofMintCount: Object.keys(proofAmounts).length,
      readyProofCount: countReadyProofs(proofAmounts),
    });
    listeners.forEach((fn) => fn());
  }

  async function refresh() {
    if (disposed) {
      logger.debug('walletContextTracker.refresh.skipped', {
        reason: 'disposed',
      });
      return;
    }
    if (refreshing) {
      pendingRefresh = true;
      logger.debug('walletContextTracker.refresh.coalesced', {
        pendingRefresh,
        consecutiveFailures,
      });
      return;
    }
    refreshing = true;
    const refreshId = ++refreshSequence;
    logger.debug('walletContextTracker.refresh.start', {
      refreshId,
      consecutiveFailures,
    });

    try {
      const [trustedMints, balancesByMint] = await Promise.all([
        manager.mint.getAllTrustedMints(),
        manager.wallet.balances.byMint(),
      ]);

      const amounts: Record<string, number[]> = Object.fromEntries(
        await Promise.all(
          trustedMints.map(async (mint) => {
            const mintUrl = (mint as TrustedMint).mintUrl;
            try {
              const proofs = await getReadyProofs(manager, mintUrl);
              return [
                mintUrl,
                proofs
                  .map((p) => amountToNumber(p.amount))
                  .sort((a, b) => a - b),
              ] as const;
            } catch (e) {
              logger.warn('walletContextTracker.getReadyProofs.failed', {
                ...mintUrlFields(mintUrl),
                error: errField(e),
              });
              return [mintUrl, []] as const;
            }
          }),
        ),
      );

      trustedMintUrls = trustedMints.map((m) => m.mintUrl);
      mintMethodCapabilities = deriveMintMethodCapabilityMapFromTrustedMints(
        trustedMints.map((mint) => ({
          mintUrl: mint.mintUrl,
          mintInfo: mint.mintInfo,
        })),
      );
      mintBalances = Object.fromEntries(
        Object.entries(balancesByMint).map(([url, snap]) => [
          url,
          amountToNumber(snap.total),
        ]),
      );
      proofAmounts = amounts;
      consecutiveFailures = 0;
      logger.info('walletContextTracker.refresh.done', {
        refreshId,
        trustedMintCount: trustedMintUrls.length,
        balanceMintCount: Object.keys(mintBalances).length,
        proofMintCount: Object.keys(proofAmounts).length,
        readyProofCount: countReadyProofs(proofAmounts),
        capabilityMintCount: Object.keys(mintMethodCapabilities).length,
        listenerCount: listeners.size,
      });

      emit();
    } catch (e) {
      consecutiveFailures += 1;
      logger.warn('walletContextTracker.refresh.failed', {
        consecutiveFailures,
        error: errField(e),
      });
      // Drop any queued retry on persistent failure so we don't re-enter the
      // loop; the next Manager event still scheduled new work via .on().
      if (consecutiveFailures >= MAX_CONSECUTIVE_REFRESH_FAILURES) {
        logger.warn('walletContextTracker.refresh.backoffLimit', {
          refreshId,
          consecutiveFailures,
        });
        pendingRefresh = false;
      }
    } finally {
      refreshing = false;
      if (
        pendingRefresh &&
        consecutiveFailures < MAX_CONSECUTIVE_REFRESH_FAILURES &&
        !disposed
      ) {
        pendingRefresh = false;
        logger.debug('walletContextTracker.refresh.pendingReplay', {
          refreshId,
          consecutiveFailures,
        });
        void refresh();
      }
    }
  }

  const eventNames = [
    'proofs:saved',
    'proofs:state-changed',
    'proofs:deleted',
    'proofs:reserved',
    'proofs:released',
    'mint:added',
    'mint:trusted',
    'mint:untrusted',
  ] as const;

  const unsubscribes = eventNames.map((eventName) =>
    manager.on(eventName as ManagerEventName, () => {
      // A new Manager event is a fresh signal — reset the failure budget so
      // a previously-poisoned tracker can recover once the underlying issue
      // (e.g. DB rehydration finishing) is resolved.
      logger.info('walletContextTracker.managerEvent', {
        eventName,
        consecutiveFailures,
      });
      consecutiveFailures = 0;
      void refresh();
    }),
  );

  void refresh();

  return {
    getContext: () => ({
      trustedMintUrls,
      mintBalances,
      mintMethodCapabilities,
      proofAmounts,
      preferredMintUrl: config?.getPreferredMintUrl?.(),
    }),
    subscribe: (listener) => {
      listeners.add(listener);
      logger.debug('walletContextTracker.subscribe', {
        listenerCount: listeners.size,
      });
      return () => {
        listeners.delete(listener);
        logger.debug('walletContextTracker.unsubscribe', {
          listenerCount: listeners.size,
        });
      };
    },
    refresh,
    dispose: () => {
      if (disposed) {
        logger.debug('walletContextTracker.dispose.skipped', {
          reason: 'already_disposed',
        });
        return;
      }
      disposed = true;
      logger.info('walletContextTracker.dispose', {
        listenerCount: listeners.size,
        trustedMintCount: trustedMintUrls.length,
        balanceMintCount: Object.keys(mintBalances).length,
        proofMintCount: Object.keys(proofAmounts).length,
      });
      unsubscribes.forEach((unsub) => unsub());
      listeners.clear();
    },
  };
}
