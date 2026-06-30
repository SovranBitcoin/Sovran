/**
 * WalletContextProvider — aggregates coco wallet state for colada.
 *
 * Provides a pre-built WalletContext (trustedMintUrls, mintBalances, proofAmounts,
 * preferredMintUrl) so call sites don't need to construct it or fetch proofs.
 * Proof amounts are fetched via the shared/lib/cashu/managerInternals seam when
 * balance changes.
 *
 * Must be a descendant of CocoProvider (CocoCashuProvider).
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useBalanceContext, useManager, useMints } from '@cashu/coco-react';
import {
  deriveMintMethodCapabilityMapFromTrustedMints,
  type WalletContext,
} from '@sovranbitcoin/colada';
import { getReadyProofs } from '@/shared/lib/cashu/managerInternals';
import { amountToNumber } from '@/shared/lib/cashu/amount';

import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useShallowMemo } from '@/shared/hooks/useShallowMemo';
import { walletLog, initLog, useInitMount } from '@/shared/lib/logger';

initLog('Module', 'WalletContextProvider loaded');

const WalletContextCtx = createContext<WalletContext | null>(null);

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}

function preferredMintLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasPreferredMintUrl: !!mintUrl,
    preferredMintUrlLength: mintUrl?.length ?? 0,
  };
}

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
  useInitMount('WalletContextProvider');
  const { trustedMints: rawTrustedMints } = useMints();
  const { balances: rawBalanceCtx } = useBalanceContext();
  const rawMintBalances = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(rawBalanceCtx.byMint).map(([url, snap]) => [url, amountToNumber(snap.total)])
      ) as Record<string, number>,
    [rawBalanceCtx]
  );
  const manager = useManager();
  const preferredMintUrl = useMintStore((state) => state.selectedMint);

  const [proofAmounts, setProofAmounts] = useState<Record<string, number[]>>({});

  // Stabilise coco-react references — they return new objects every render
  const mintBalances = useShallowMemo(rawMintBalances);

  // Stabilise trustedMintUrls by comparing the serialised URL list
  const trustedMintUrls = useMemo(() => rawTrustedMints.map((m) => m.mintUrl), [rawTrustedMints]);
  const mintMethodCapabilities = useMemo(
    () =>
      deriveMintMethodCapabilityMapFromTrustedMints(
        rawTrustedMints.map((mint) => ({
          mintUrl: mint.mintUrl,
          mintInfo: mint.mintInfo,
        }))
      ),
    [rawTrustedMints]
  );
  const prevMintUrlsRef = useRef<string[]>(trustedMintUrls);
  const stableMintUrls = useMemo(() => {
    const prev = prevMintUrlsRef.current;
    if (prev.length === trustedMintUrls.length && prev.every((u, i) => u === trustedMintUrls[i])) {
      return prev;
    }
    prevMintUrlsRef.current = trustedMintUrls;
    return trustedMintUrls;
  }, [trustedMintUrls]);

  // RC4+ removed the legacy `total` injection into the per-mint map; mintBalances
  // already contains only mint-keyed entries.
  const mintBalancesOnly = mintBalances;

  // Stable balance signature so `fetchProofAmounts` re-runs whenever any mint
  // balance changes (i.e. after a send / receive). Without this the cached
  // `proofAmounts` would only refresh on mint-add, leaving "Send all" showing
  // the pre-spend total — the user-reported bug where the quick suggestions
  // sometimes exceed the actual spendable balance.
  const balanceSignature = useMemo(
    () =>
      Object.entries(mintBalancesOnly)
        .map(([url, total]) => `${url}:${total}`)
        .sort()
        .join('|'),
    [mintBalancesOnly]
  );

  const fetchProofAmounts = useCallback(async () => {
    walletLog.debug('provider.wallet_context.fetch_proof_amounts_start', {
      mintCount: stableMintUrls.length,
    });
    const next: Record<string, number[]> = {};
    let totalReady = 0;
    for (const url of stableMintUrls) {
      try {
        const proofs = await getReadyProofs(manager, url);
        const amounts = proofs.map((p) => amountToNumber(p.amount)).sort((a, b) => a - b);
        const proofTotal = amounts.reduce((sum, n) => sum + n, 0);
        next[url] = amounts;
        totalReady += proofTotal;
        walletLog.debug('provider.wallet_context.proof_fetch_done', {
          ...mintUrlLogFields(url),
          proofCount: amounts.length,
          proofTotal,
        });
      } catch (err) {
        walletLog.warn('provider.wallet_context.proof_fetch_failed', {
          ...mintUrlLogFields(url),
          error: err instanceof Error ? err : new Error(String(err)),
        });
        next[url] = [];
      }
    }
    walletLog.debug('provider.wallet_context.fetch_proof_amounts_done', {
      mintCount: stableMintUrls.length,
      totalReady,
    });
    setProofAmounts(next);
  }, [manager, stableMintUrls]);

  useEffect(() => {
    void fetchProofAmounts();
    // balanceSignature isn't used inside fetchProofAmounts but its change is the
    // signal that proofs have moved — depend on it explicitly.
  }, [fetchProofAmounts, balanceSignature]);

  const value = useMemo<WalletContext>(() => {
    const proofMintCount = Object.keys(proofAmounts).length;
    const proofCount = Object.values(proofAmounts).reduce(
      (sum, amounts) => sum + amounts.length,
      0
    );
    walletLog.info('provider.wallet_context.value_updated', {
      trustedMintCount: stableMintUrls.length,
      totalBalance: Object.values(mintBalancesOnly).reduce((sum, b) => sum + b, 0),
      proofMintCount,
      proofCount,
      ...preferredMintLogFields(preferredMintUrl),
    });
    return {
      trustedMintUrls: stableMintUrls,
      mintBalances: mintBalancesOnly,
      preferredMintUrl,
      mintMethodCapabilities,
      proofAmounts,
    };
  }, [stableMintUrls, mintBalancesOnly, preferredMintUrl, mintMethodCapabilities, proofAmounts]);

  return <WalletContextCtx.Provider value={value}>{children}</WalletContextCtx.Provider>;
}
