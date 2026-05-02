// ---------------------------------------------------------------------------
// WalletContextTracker — maintains a live WalletContext from Manager events
//
// Subscribes to Manager events (proofs, mints) and maintains an up-to-date
// WalletContext. Framework-agnostic — no React dependency.
// ---------------------------------------------------------------------------

import type { Manager } from '@cashu/coco-core';
import { getReadyProofs } from '../api/managerInternals';
import type { WalletContext } from '../types';

export interface WalletContextTrackerConfig {
  getPreferredMintUrl?: () => string | undefined;
}

export interface WalletContextTracker {
  getContext: () => WalletContext;
  subscribe: (listener: () => void) => () => void;
  refresh: () => Promise<void>;
  dispose: () => void;
}

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

  function emit() {
    listeners.forEach((fn) => fn());
  }

  async function refresh() {
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

      const amounts: Record<string, number[]> = {};

      for (const mint of trustedMints) {
        try {
          const proofs = await getReadyProofs(manager, (mint as any).mintUrl);
          amounts[(mint as any).mintUrl] = proofs
            .map((p) => p.amount)
            .sort((a, b) => a - b);
        } catch (e) {
          console.warn('[walletContextTracker] getReadyProofs failed for', (mint as any).mintUrl, e instanceof Error ? e.message : e);
          amounts[(mint as any).mintUrl] = [];
        }
      }

      trustedMintUrls = trustedMints.map((m: any) => m.mintUrl);
      mintBalances = Object.fromEntries(
        Object.entries(balancesByMint).map(([url, snap]) => [url, snap.total])
      );
      proofAmounts = amounts;

      emit();
    } finally {
      refreshing = false;
      if (pendingRefresh) {
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
      unsubscribes.forEach((unsub) => unsub());
      listeners.clear();
    },
  };
}
