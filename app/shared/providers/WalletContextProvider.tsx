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
  deriveSupportedUnitsFromInfo,
  pickHighestBalanceUnit,
  type WalletContext,
} from 'wallet';
import { getReadyProofs } from '@/shared/lib/cashu/managerInternals';
import { amountToNumber } from '@/shared/lib/cashu/amount';

import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useActiveUnit } from '@/features/wallet/hooks/useActiveUnit';
import { useMintKeysetUnits } from '@/features/wallet/hooks/useMintKeysetUnits';
import { useShallowMemo } from '@/shared/hooks/useShallowMemo';
import { walletLog, initLog, useInitMount, mintUrlLogFields } from '@/shared/lib/logger';

initLog('Module', 'WalletContextProvider loaded');

const WalletContextCtx = createContext<WalletContext | null>(null);

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
  // The whole wallet view is scoped to the active mint unit (coco v2
  // multi-unit): balances, method capabilities, and proof amounts below all
  // read the active unit's slice.
  const { unit: activeUnit, setUnit: setActiveUnit } = useActiveUnit();
  const rawMintBalances = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(rawBalanceCtx.byMintAndUnit ?? {}).map(([url, byUnit]) => [
          url,
          byUnit[activeUnit] ? amountToNumber(byUnit[activeUnit].total) : 0,
        ])
      ) as Record<string, number>,
    [rawBalanceCtx, activeUnit]
  );
  const manager = useManager();
  const preferredMintUrl = useMintStore((state) => state.selectedMint);

  const [proofAmounts, setProofAmounts] = useState<Record<string, number[]>>({});

  // Stabilise coco-react references — they return new objects every render
  const mintBalances = useShallowMemo(rawMintBalances);

  // Stabilise trustedMintUrls by comparing the serialised URL list
  const trustedMintUrls = useMemo(() => rawTrustedMints.map((m) => m.mintUrl), [rawTrustedMints]);
  // keysetUnits gates advertised method-units on the mint's REAL keysets —
  // a NUT-04 unit without a backing keyset cannot be issued (coco throws
  // "No valid keysets found" at quote creation).
  const keysetUnitsByMint = useMintKeysetUnits();
  const mintMethodCapabilities = useMemo(
    () =>
      deriveMintMethodCapabilityMapFromTrustedMints(
        rawTrustedMints.map((mint) => ({
          mintUrl: mint.mintUrl,
          mintInfo: mint.mintInfo,
          keysetUnits: keysetUnitsByMint[mint.mintUrl],
        })),
        activeUnit
      ),
    [rawTrustedMints, activeUnit, keysetUnitsByMint]
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

  // Follow the preferred mint with the active unit: when the user switches
  // mints and the new mint doesn't support the current unit, snap to the
  // unit holding the highest balance AT THAT MINT (not blindly sat) —
  // colada's pickHighestBalanceUnit, tie-broken sat-first. Derived from
  // CACHED NUT-04 mintInfo in coco's DB, so this works offline — no
  // info-endpoint call. Keyed on the mint URL (a ref, not an effect dep on
  // activeUnit) so a manual unit switch is never fought by this rule; the
  // switcher's own mint-follow (selectUnit) always lands on a supporting
  // mint, so the two rules cannot ping-pong.
  const lastUnitSyncMintRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!preferredMintUrl || lastUnitSyncMintRef.current === preferredMintUrl) return;
    lastUnitSyncMintRef.current = preferredMintUrl;
    const mint = rawTrustedMints.find((m) => m.mintUrl === preferredMintUrl);
    if (!mint) return;
    const supported = deriveSupportedUnitsFromInfo(mint.mintInfo, keysetUnitsByMint[mint.mintUrl]);
    const currentUnit = useMintStore.getState().activeUnit;
    if (supported.includes(currentUnit)) return;
    const balanceByUnit = Object.fromEntries(
      Object.entries(rawBalanceCtx.byMintAndUnit?.[preferredMintUrl] ?? {}).map(
        ([unitKey, snapshot]) => [unitKey, snapshot ? amountToNumber(snapshot.total) : 0]
      )
    );
    const next = pickHighestBalanceUnit(supported, balanceByUnit);
    if (next !== 'sat' && next !== 'usd' && next !== 'eur' && next !== 'gbp') return;
    walletLog.info('wallet.unit.synced_to_mint', {
      ...preferredMintLogFields(preferredMintUrl),
      from: currentUnit,
      to: next,
      source: 'highest_balance_at_mint',
    });
    setActiveUnit(next);
  }, [preferredMintUrl, rawTrustedMints, rawBalanceCtx, setActiveUnit, keysetUnitsByMint]);

  const fetchProofAmounts = useCallback(async () => {
    walletLog.debug('provider.wallet_context.fetch_proof_amounts_start', {
      mintCount: stableMintUrls.length,
    });
    const next: Record<string, number[]> = {};
    let totalReady = 0;
    // Per-mint reads are independent — run them concurrently.
    await Promise.all(
      stableMintUrls.map(async (url) => {
        try {
          const proofs = await getReadyProofs(manager, url);
          const amounts = proofs
            .filter((p) => (p.unit ?? 'sat') === activeUnit)
            .map((p) => amountToNumber(p.amount))
            .sort((a, b) => a - b);
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
      })
    );
    walletLog.debug('provider.wallet_context.fetch_proof_amounts_done', {
      mintCount: stableMintUrls.length,
      totalReady,
    });
    setProofAmounts(next);
  }, [manager, stableMintUrls, activeUnit]);

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
