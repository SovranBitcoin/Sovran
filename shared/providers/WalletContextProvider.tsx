/**
 * WalletContextProvider — aggregates coco wallet state for coco-payment-ux.
 *
 * Provides a pre-built WalletContext (trustedMintUrls, mintBalances, proofAmounts,
 * preferredMintUrl) so call sites don't need to construct it or fetch proofs.
 * Proof amounts are fetched from manager.proofService when balance changes.
 *
 * Must be a descendant of CocoProvider (CocoCashuProvider).
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useBalanceContext, useManager, useMints } from '@cashu/coco-react';
import type { WalletContext } from 'coco-payment-ux';

import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';

const WalletContextCtx = createContext<WalletContext | null>(null);

export function useWalletContext(): WalletContext {
  const ctx = useContext(WalletContextCtx);
  if (!ctx) {
    throw new Error(
      'WalletContextProvider is missing. Wrap your app in WalletContextProvider (inside CocoProvider).'
    );
  }
  return ctx;
}

/**
 * Returns WalletContext with optional preferredMintUrl override.
 * Use when the flow has a specific mint (e.g. selected on amount screen).
 */
export function useWalletContextWithOverride(preferredMintUrl?: string): WalletContext {
  const ctx = useWalletContext();
  return useMemo(
    () => (preferredMintUrl != null ? { ...ctx, preferredMintUrl } : ctx),
    [ctx, preferredMintUrl]
  );
}

export function WalletContextProvider({ children }: { children: React.ReactNode }) {
  const { trustedMints } = useMints();
  const { balance: mintBalances } = useBalanceContext();
  const manager = useManager();
  const { keys } = useNostrKeysContext();
  const pubkey = keys?.pubkey;
  const preferredMintUrl = useMintStore(
    useCallback((state) => (pubkey ? state.selectedMints[pubkey] : undefined), [pubkey])
  );

  const [proofAmounts, setProofAmounts] = useState<Record<string, number[]>>({});

  const trustedMintUrls = useMemo(() => trustedMints.map((m) => m.mintUrl), [trustedMints]);

  const fetchProofAmounts = useCallback(async () => {
    const proofService = (
      manager as unknown as {
        proofService: { getReadyProofs: (url: string) => Promise<Array<{ amount: number }>> };
      }
    ).proofService;
    const next: Record<string, number[]> = {};
    for (const mint of trustedMints) {
      try {
        const proofs = await proofService.getReadyProofs(mint.mintUrl);
        next[mint.mintUrl] = proofs.map((p) => p.amount).sort((a, b) => a - b);
      } catch {
        next[mint.mintUrl] = [];
      }
    }
    setProofAmounts(next);
  }, [manager, trustedMints]);

  useEffect(() => {
    fetchProofAmounts();
  }, [fetchProofAmounts]);

  const mintBalancesOnly = useMemo(() => {
    const { total: _total, ...rest } = mintBalances;
    return rest as Record<string, number>;
  }, [mintBalances]);

  const value = useMemo<WalletContext>(
    () => ({
      trustedMintUrls,
      mintBalances: mintBalancesOnly,
      preferredMintUrl,
      proofAmounts,
    }),
    [trustedMintUrls, mintBalancesOnly, preferredMintUrl, proofAmounts]
  );

  return <WalletContextCtx.Provider value={value}>{children}</WalletContextCtx.Provider>;
}
