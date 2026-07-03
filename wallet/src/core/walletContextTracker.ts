// ---------------------------------------------------------------------------
// WalletContextTracker — maintains a live WalletContext from Manager events
//
// Subscribes to Manager events (proofs, mints) and maintains an up-to-date
// WalletContext. Framework-agnostic — no React dependency.
// ---------------------------------------------------------------------------

import type { CoreProof, Manager } from '@cashu/coco-core';
import { amountToNumber } from '../amount';
import { getKeysetUnits } from './keysetUnits';
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
  /**
   * The wallet's ACTIVE unit. The tracker snapshots proofs and balances for
   * every unit, then getContext() serves the view for this unit — balances,
   * proof amounts, and the capability map are all denominated per unit, so
   * machine-internal comparisons (exceedsBalance, offline proof composition)
   * never mix usd-cents with sat proofs. Omit for sat-only wallets.
   */
  getActiveUnit?: () => string;
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
  // All-unit snapshots from the last successful refresh. getContext()
  // derives (and caches) the active-unit view from these, so a unit switch
  // is served instantly from the same snapshot — no refresh race.
  let trustedMints: {
    mintUrl: string;
    mintInfo?: unknown;
    keysetUnits?: string[];
  }[] = [];
  let proofsByMint: Record<string, { amount: number; unit: string }[]> = {};
  let balancesByMintAndUnit: Record<string, Record<string, number>> = {};
  let revision = 0;

  let unitView: {
    unit: string;
    revision: number;
    trustedMintUrls: string[];
    mintBalances: Record<string, number>;
    proofAmounts: Record<string, number[]>;
    mintMethodCapabilities: WalletContext['mintMethodCapabilities'];
  } | null = null;

  const activeUnit = (): string =>
    (config?.getActiveUnit?.() || 'sat').toLowerCase();

  function viewFor(unit: string) {
    if (unitView && unitView.unit === unit && unitView.revision === revision) {
      return unitView;
    }
    unitView = {
      unit,
      revision,
      trustedMintUrls: trustedMints.map((m) => m.mintUrl),
      mintBalances: Object.fromEntries(
        Object.entries(balancesByMintAndUnit).map(([url, byUnit]) => [
          url,
          byUnit[unit] ?? 0,
        ]),
      ),
      proofAmounts: Object.fromEntries(
        Object.entries(proofsByMint).map(([url, proofs]) => [
          url,
          proofs
            .filter((p) => p.unit === unit)
            .map((p) => p.amount)
            .sort((a, b) => a - b),
        ]),
      ),
      mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints(
        trustedMints,
        unit,
      ),
    };
    logger.debug('walletContextTracker.unitView.derived', {
      unit,
      revision,
      trustedMintCount: unitView.trustedMintUrls.length,
      readyProofCount: countReadyProofs(unitView.proofAmounts),
    });
    return unitView;
  }

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
      trustedMintCount: trustedMints.length,
      balanceMintCount: Object.keys(balancesByMintAndUnit).length,
      proofMintCount: Object.keys(proofsByMint).length,
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
      const [mints, balances] = await Promise.all([
        manager.mint.getAllTrustedMints(),
        manager.wallet.balances.byMintAndUnit(),
      ]);

      const proofs: Record<string, { amount: number; unit: string }[]> =
        Object.fromEntries(
          await Promise.all(
            mints.map(async (mint) => {
              const mintUrl = (mint as TrustedMint).mintUrl;
              try {
                const ready = await getReadyProofs(manager, mintUrl);
                return [
                  mintUrl,
                  ready.map((p) => ({
                    amount: amountToNumber(p.amount),
                    unit: (p.unit || 'sat').toLowerCase(),
                  })),
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

      const keysetUnitsByMint: Record<string, string[] | undefined> =
        Object.fromEntries(
          await Promise.all(
            mints.map(async (mint) => {
              const mintUrl = (mint as TrustedMint).mintUrl;
              try {
                return [mintUrl, await getKeysetUnits(manager, mintUrl)] as const;
              } catch (e) {
                logger.warn('walletContextTracker.getKeysetUnits.failed', {
                  ...mintUrlFields(mintUrl),
                  error: errField(e),
                });
                // Unknown (not empty): capability gating must not turn a
                // read failure into "mint issues nothing".
                return [mintUrl, undefined] as const;
              }
            }),
          ),
        );

      trustedMints = mints.map((mint) => ({
        mintUrl: mint.mintUrl,
        mintInfo: mint.mintInfo,
        keysetUnits: keysetUnitsByMint[mint.mintUrl],
      }));
      balancesByMintAndUnit = Object.fromEntries(
        Object.entries(balances).map(([url, byUnit]) => [
          url,
          Object.fromEntries(
            Object.entries(byUnit).map(([unit, snap]) => [
              unit.toLowerCase(),
              amountToNumber(snap.total),
            ]),
          ),
        ]),
      );
      proofsByMint = proofs;
      revision += 1;
      consecutiveFailures = 0;
      logger.info('walletContextTracker.refresh.done', {
        refreshId,
        revision,
        trustedMintCount: trustedMints.length,
        balanceMintCount: Object.keys(balancesByMintAndUnit).length,
        proofMintCount: Object.keys(proofsByMint).length,
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
    getContext: () => {
      const view = viewFor(activeUnit());
      return {
        trustedMintUrls: view.trustedMintUrls,
        mintBalances: view.mintBalances,
        mintMethodCapabilities: view.mintMethodCapabilities,
        proofAmounts: view.proofAmounts,
        preferredMintUrl: config?.getPreferredMintUrl?.(),
      };
    },
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
        trustedMintCount: trustedMints.length,
        balanceMintCount: Object.keys(balancesByMintAndUnit).length,
        proofMintCount: Object.keys(proofsByMint).length,
      });
      unsubscribes.forEach((unsub) => unsub());
      listeners.clear();
    },
  };
}
