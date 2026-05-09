// ---------------------------------------------------------------------------
// WalletContextTracker — maintains a live WalletContext from Manager events
//
// Subscribes to Manager events (proofs, mints) and maintains an up-to-date
// WalletContext. Framework-agnostic — no React dependency.
// ---------------------------------------------------------------------------

import type { CoreProof, Manager } from '@cashu/coco-core';
import { errField, logger } from '../logger';
import type { WalletContext } from '../types';

// Reach past coco's `private` ProofService to get the ready (UNSPENT,
// unreserved) proofs for one mint. The public surface only exposes balance
// totals; the tracker needs the per-proof amount distribution to drive
// offline-amount composition. Cast lives here because the tracker is the
// only intra-package consumer; sovran-side reach-ins live in
// sovran-app/shared/lib/cashu/managerInternals.ts.
function getReadyProofs(manager: Manager, mintUrl: string): Promise<CoreProof[]> {
  return (
    manager as unknown as {
      proofService: { getReadyProofs(mintUrl: string): Promise<CoreProof[]> };
    }
  ).proofService.getReadyProofs(mintUrl);
}

interface WalletContextTrackerConfig {
  getPreferredMintUrl?: () => string | undefined;
}

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

export function createWalletContextTracker(
  manager: Manager,
  config?: WalletContextTrackerConfig
): WalletContextTracker {
  let trustedMintUrls: string[] = [];
  let mintBalances: Record<string, number> = {};
  let proofAmounts: Record<string, number[]> = {};

  const listeners = new Set<() => void>();
  let refreshing = false;
  let pendingRefresh = false;
  let consecutiveFailures = 0;
  let disposed = false;

  function emit() {
    listeners.forEach((fn) => fn());
  }

  async function refresh() {
    if (disposed) return;
    if (refreshing) {
      pendingRefresh = true;
      return;
    }
    refreshing = true;

    try {
      const [trustedMints, balancesByMint] = await Promise.all([
        manager.mint.getAllTrustedMints(),
        manager.wallet.balances.byMint(),
      ]);

      const amounts: Record<string, number[]> = Object.fromEntries(
        await Promise.all(
          trustedMints.map(async (mint) => {
            const mintUrl = (mint as any).mintUrl as string;
            try {
              const proofs = await getReadyProofs(manager, mintUrl);
              return [mintUrl, proofs.map((p) => p.amount).sort((a, b) => a - b)] as const;
            } catch (e) {
              logger.warn('walletContextTracker.getReadyProofs.failed', {
                mintUrl,
                error: errField(e),
              });
              return [mintUrl, []] as const;
            }
          })
        )
      );

      trustedMintUrls = trustedMints.map((m: any) => m.mintUrl);
      mintBalances = Object.fromEntries(
        Object.entries(balancesByMint).map(([url, snap]) => [url, snap.total])
      );
      proofAmounts = amounts;
      consecutiveFailures = 0;

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
        pendingRefresh = false;
      }
    } finally {
      refreshing = false;
      if (pendingRefresh && consecutiveFailures < MAX_CONSECUTIVE_REFRESH_FAILURES && !disposed) {
        pendingRefresh = false;
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
    manager.on(eventName as any, () => {
      // A new Manager event is a fresh signal — reset the failure budget so
      // a previously-poisoned tracker can recover once the underlying issue
      // (e.g. DB rehydration finishing) is resolved.
      consecutiveFailures = 0;
      void refresh();
    })
  );

  void refresh();

  return {
    getContext: () => ({
      trustedMintUrls,
      mintBalances,
      proofAmounts,
      preferredMintUrl: config?.getPreferredMintUrl?.(),
    }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    dispose: () => {
      disposed = true;
      unsubscribes.forEach((unsub) => unsub());
      listeners.clear();
    },
  };
}
