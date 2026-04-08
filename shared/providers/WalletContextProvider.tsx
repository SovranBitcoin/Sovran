/**
 * WalletContextProvider — aggregates coco wallet state for coco-payment-ux.
 *
 * Provides a pre-built WalletContext (trustedMintUrls, mintBalances, proofAmounts,
 * preferredMintUrl) so call sites don't need to construct it or fetch proofs.
 * Proof amounts are fetched from manager.proofService when balance changes.
 *
 * Must be a descendant of CocoProvider (CocoCashuProvider).
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useBalanceContext, useManager, useMints } from '@cashu/coco-react';
import type { WalletContext } from 'coco-payment-ux';

import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useShallowMemo } from '@/shared/hooks/useShallowMemo';
import { walletLog } from '@/shared/lib/logger';

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
  const { trustedMints: rawTrustedMints } = useMints();
  const { balance: rawMintBalances } = useBalanceContext();
  const manager = useManager();
  const { keys } = useNostrKeysContext();
  const pubkey = keys?.pubkey;
  const preferredMintUrl = useMintStore(
    useCallback((state) => (pubkey ? state.selectedMints[pubkey] : undefined), [pubkey])
  );

  const [proofAmounts, setProofAmounts] = useState<Record<string, number[]>>({});

  // Stabilise coco-react references — they return new objects every render
  const mintBalances = useShallowMemo(rawMintBalances);

  // Stabilise trustedMintUrls by comparing the serialised URL list
  const trustedMintUrls = useMemo(() => rawTrustedMints.map((m) => m.mintUrl), [rawTrustedMints]);
  const prevMintUrlsRef = useRef<string[]>(trustedMintUrls);
  const stableMintUrls = useMemo(() => {
    const prev = prevMintUrlsRef.current;
    if (prev.length === trustedMintUrls.length && prev.every((u, i) => u === trustedMintUrls[i])) {
      return prev;
    }
    prevMintUrlsRef.current = trustedMintUrls;
    return trustedMintUrls;
  }, [trustedMintUrls]);

  const fetchProofAmounts = useCallback(async () => {
    walletLog.debug('provider.wallet_context.fetch_proof_amounts_start', { mintCount: stableMintUrls.length });
    const proofService = manager.proofService;
    const next: Record<string, number[]> = {};
    for (const url of stableMintUrls) {
      try {
        const proofs = await proofService.getReadyProofs(url);
        next[url] = proofs.map((p) => p.amount).sort((a, b) => a - b);
      } catch (err) {
        walletLog.warn('provider.wallet_context.proof_fetch_failed', { mintUrl: url, error: err instanceof Error ? err : new Error(String(err)) });
        next[url] = [];
      }
    }
    walletLog.debug('provider.wallet_context.fetch_proof_amounts_done', { mintCount: stableMintUrls.length });
    setProofAmounts(next);
  }, [manager, stableMintUrls]);

  useEffect(() => {
    fetchProofAmounts();
  }, [fetchProofAmounts]);

  const mintBalancesOnly = useMemo(() => {
    const { total: _total, ...rest } = mintBalances;
    return rest as Record<string, number>;
  }, [mintBalances]);

  const value = useMemo<WalletContext>(() => {
    walletLog.info('provider.wallet_context.value_updated', {
      trustedMintCount: stableMintUrls.length,
      totalBalance: Object.values(mintBalancesOnly).reduce((sum, b) => sum + b, 0),
      preferredMintUrl,
    });
    return {
      trustedMintUrls: stableMintUrls,
      mintBalances: mintBalancesOnly,
      preferredMintUrl,
      proofAmounts,
    };
  }, [stableMintUrls, mintBalancesOnly, preferredMintUrl, proofAmounts]);

  return <WalletContextCtx.Provider value={value}>{children}</WalletContextCtx.Provider>;
}
