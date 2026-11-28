/**
 * The wallet as the payment machine sees it: trusted mint URLs, per-mint and
 * per-unit balances, proof denominations, method capabilities and the
 * preferred mint, derived from Coco for the active unit and testnut side.
 * Mounted inside `WalletCore`. It holds no copy of mints, proofs or balances;
 * proof denominations are read through the `managerInternals` seam when they
 * change.
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
  toAccountUnit,
  type WalletContext,
} from 'wallet';
import { getReadyProofs } from '@/shared/lib/cashu/managerInternals';
import { amountToNumber } from 'wallet/amount';

import { useIsTestnutMint } from '@/shared/stores/global/mintTestnutStore';
import { useMintStore, type ActiveUnit } from '@/shared/stores/profile/mintStore';
import { useActiveUnit } from '@/features/wallet/hooks/useActiveUnit';
import {
  hasSettledKeysetRead,
  useMintKeysetUnits,
} from '@/features/wallet/hooks/useMintKeysetUnits';
import { useShallowMemo } from '@/shared/hooks/useShallowMemo';
import { walletLog, useInitMount, mintUrlLogFields } from '@/shared/lib/logger';
import { countIdleWork } from '@/shared/lib/loggerIdleCounters';

const WalletContextCtx = createContext<WalletContext | null>(null);
const EMPTY_PROOF_AMOUNTS: Record<string, number[]> = {};

type ProofAmountsScope = {
  manager: ReturnType<typeof useManager>;
  unit: string;
  mintUrls: readonly string[];
  balanceSignature: string;
};

function preferredMintLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasPreferredMintUrl: !!mintUrl,
    preferredMintUrlLength: mintUrl?.length ?? 0,
  };
}

export function useWalletContext(): WalletContext {
  const ctx = useContext(WalletContextCtx);
  if (!ctx) {
    throw new Error('WalletProjection is missing. Mount it inside WalletCore.');
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

export function WalletProjection({ children }: { children: React.ReactNode }) {
  useInitMount('WalletContextProvider');
  const { trustedMints: rawTrustedMints } = useMints();
  const { balances: rawBalanceCtx } = useBalanceContext();
  // The whole wallet view is scoped to the active mint unit (coco v2
  // multi-unit): balances, method capabilities, and proof amounts below all
  // read the active unit's slice.
  //
  // The testnut split is enforced HERE for the payment machine: it works in
  // the account's real mint unit (`activeUnit`), and a mint on the other side
  // of the split (a testnut mint while a real account is active, or the
  // reverse) contributes no balance and no method capability. So no send,
  // melt, receive rail or auto-pick can mix test funds with real ones.
  const { realUnit: activeUnit, testnut: testnutAccount, setUnit: setActiveUnit } = useActiveUnit();
  const isTestnutMint = useIsTestnutMint();
  const inActiveAccount = useCallback(
    (mintUrl: string) => isTestnutMint(mintUrl) === testnutAccount,
    [isTestnutMint, testnutAccount]
  );
  const { mintBalances: rawMintBalances, unitBalances } = useMemo(() => {
    const unitBalances: Record<string, Record<string, number>> = {};
    for (const [mintUrl, byUnit] of Object.entries(rawBalanceCtx.byMintAndUnit ?? {})) {
      if (!inActiveAccount(mintUrl)) continue;
      for (const [unit, snapshot] of Object.entries(byUnit)) {
        const unitEntry = unitBalances[unit] ?? (unitBalances[unit] = {});
        unitEntry[mintUrl] = snapshot ? amountToNumber(snapshot.total) : 0;
      }
    }
    return {
      mintBalances: Object.fromEntries(
        Object.entries(rawBalanceCtx.byMintAndUnit ?? {}).map(([url, byUnit]) => [
          url,
          inActiveAccount(url) && byUnit[activeUnit] ? amountToNumber(byUnit[activeUnit].total) : 0,
        ])
      ),
      unitBalances,
    };
  }, [rawBalanceCtx, activeUnit, inActiveAccount]);
  const manager = useManager();
  const preferredMintUrl = useMintStore((state) => state.selectedMint);
  const [mintStoreHydrated, setMintStoreHydrated] = useState(
    () => useMintStore.persist?.hasHydrated?.() ?? true
  );

  useEffect(() => {
    if (mintStoreHydrated) return;
    const persistApi = useMintStore.persist;
    if (!persistApi || persistApi.hasHydrated()) {
      setMintStoreHydrated(true);
      return;
    }
    return persistApi.onFinishHydration(() => setMintStoreHydrated(true));
  }, [mintStoreHydrated]);

  // Auto-select a trusted mint whenever the wallet holds trusted mints but has
  // no current selection (or its stored selection was untrusted). Runs only
  // after `mint-store` hydrates so a saved choice is never overwritten on boot.
  useEffect(() => {
    if (!mintStoreHydrated || rawTrustedMints.length === 0) return;
    if (preferredMintUrl && rawTrustedMints.some((m) => m.mintUrl === preferredMintUrl)) return;
    const setSelectedMint = useMintStore.getState?.()?.setSelectedMint;
    if (typeof setSelectedMint !== 'function') return;
    const inAccount = rawTrustedMints.filter((m) => inActiveAccount(m.mintUrl));
    const pool = inAccount.length > 0 ? inAccount : rawTrustedMints;
    let best = pool[0].mintUrl;
    let bestBalance = amountToNumber(rawBalanceCtx.byMintAndUnit?.[best]?.[activeUnit]?.total);
    for (let i = 1; i < pool.length; i += 1) {
      const candidate = pool[i].mintUrl;
      const candidateBalance = amountToNumber(
        rawBalanceCtx.byMintAndUnit?.[candidate]?.[activeUnit]?.total
      );
      if (candidateBalance > bestBalance) {
        best = candidate;
        bestBalance = candidateBalance;
      }
    }
    walletLog.info('wallet.mint.auto_selected', {
      hadPreferred: !!preferredMintUrl,
      trustedCount: rawTrustedMints.length,
    });
    setSelectedMint(best);
  }, [
    mintStoreHydrated,
    preferredMintUrl,
    rawTrustedMints,
    inActiveAccount,
    rawBalanceCtx,
    activeUnit,
  ]);

  const [proofSnapshot, setProofSnapshot] = useState<{
    scope: ProofAmountsScope;
    amounts: Record<string, number[]>;
  } | null>(null);

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
          outsideAccount: !inActiveAccount(mint.mintUrl),
        })),
        activeUnit
      ),
    [rawTrustedMints, activeUnit, keysetUnitsByMint, inActiveAccount]
  );
  const stableMintUrls = useShallowMemo(trustedMintUrls);

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
  const proofScope = useMemo<ProofAmountsScope>(
    () => ({ manager, unit: activeUnit, mintUrls: stableMintUrls, balanceSignature }),
    [manager, activeUnit, stableMintUrls, balanceSignature]
  );
  // Do not expose proof denominations from another unit, manager, mint set, or
  // pre-spend balance even for the first render before the next effect starts.
  const proofAmounts =
    proofSnapshot?.scope === proofScope ? proofSnapshot.amounts : EMPTY_PROOF_AMOUNTS;

  // Follow the preferred mint with the active unit: when the user switches
  // mints and the new mint doesn't support the current ACCOUNT unit (a testnut
  // mint never supports a real account, and vice versa), snap to the
  // unit holding the highest balance AT THAT MINT (not blindly sat) —
  // colada's pickHighestBalanceUnit, tie-broken sat-first. Derived from
  // CACHED NUT-04 mintInfo in coco's DB, so this works offline — no
  // info-endpoint call. Keyed on the mint URL (a ref, not an effect dep on
  // activeUnit) so a manual unit switch is never fought by this rule; the
  // switcher's own mint-follow (selectUnit) always lands on a supporting
  // mint, so the two rules cannot ping-pong. The key includes the mint's
  // testnut verdict, so a verdict arriving for the preferred mint moves the
  // wallet to that mint's account instead of leaving it stranded.
  const lastUnitSyncMintRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!preferredMintUrl) return;
    const preferredTestnut = isTestnutMint(preferredMintUrl);
    const syncKey = `${preferredMintUrl}|${preferredTestnut}`;
    if (lastUnitSyncMintRef.current === syncKey) return;
    // Until the mint's info has loaded its units are unknown: consuming the
    // key now would either retire a persisted `usd` to `sat` on a cold boot or
    // skip the sync for this mint for good once the info arrives.
    const mint = rawTrustedMints.find((m) => m.mintUrl === preferredMintUrl);
    if (!mint || !mint.mintInfo) return;
    // Likewise its keysets: info can advertise a unit the mint holds no keys
    // for, and deciding on the advertisement alone would consume the key
    // before the keyset read can correct it.
    if (!hasSettledKeysetRead(keysetUnitsByMint, preferredMintUrl)) return;
    lastUnitSyncMintRef.current = syncKey;
    const supported = deriveSupportedUnitsFromInfo(mint.mintInfo, keysetUnitsByMint[mint.mintUrl]);
    const currentUnit = useMintStore.getState().activeUnit;
    if (supported.some((unit) => toAccountUnit(unit, preferredTestnut) === currentUnit)) return;
    const balanceByUnit = Object.fromEntries(
      Object.entries(rawBalanceCtx.byMintAndUnit?.[preferredMintUrl] ?? {}).map(
        ([unitKey, snapshot]) => [unitKey, snapshot ? amountToNumber(snapshot.total) : 0]
      )
    );
    const next = toAccountUnit(
      pickHighestBalanceUnit(supported, balanceByUnit),
      preferredTestnut
    ) as ActiveUnit;
    walletLog.info('wallet.unit.synced_to_mint', {
      ...preferredMintLogFields(preferredMintUrl),
      from: currentUnit,
      to: next,
      source: 'highest_balance_at_mint',
    });
    setActiveUnit(next);
  }, [
    preferredMintUrl,
    rawTrustedMints,
    rawBalanceCtx,
    setActiveUnit,
    keysetUnitsByMint,
    isTestnutMint,
  ]);

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
          countIdleWork('wallet_projection.query');
          const proofs = await getReadyProofs(manager, url);
          const amounts = proofs
            .filter((p) => (p.unit ?? 'sat') === activeUnit && p.usedByOperationId == null)
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
    return next;
  }, [manager, stableMintUrls, activeUnit]);

  useEffect(() => {
    let current = true;
    let running = false;
    let requested = false;
    const reload = async () => {
      requested = true;
      if (running) return;
      running = true;
      while (current && requested) {
        requested = false;
        const amounts = await fetchProofAmounts();
        if (current && !requested) setProofSnapshot({ scope: proofScope, amounts });
      }
      running = false;
    };
    // Reservations and denomination changes can leave the total unchanged.
    // Invalidate immediately, then collapse events during a read into one
    // trailing refresh; never publish denominations from an invalidated read.
    const onProofChange = ({ mintUrl }: { mintUrl: string }) => {
      if (!current || !stableMintUrls.includes(mintUrl)) return;
      setProofSnapshot(null);
      void reload();
    };
    const events = [
      'proofs:saved',
      'proofs:state-changed',
      'proofs:reserved',
      'proofs:released',
      'proofs:deleted',
      'proofs:wiped',
    ] as const;
    for (const event of events) manager.on(event, onProofChange);
    void reload();
    return () => {
      current = false;
      for (const event of events) manager.off(event, onProofChange);
    };
  }, [fetchProofAmounts, manager, proofScope, stableMintUrls]);

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
      unitBalances,
      preferredMintUrl,
      mintMethodCapabilities,
      proofAmounts,
    };
  }, [
    stableMintUrls,
    mintBalancesOnly,
    unitBalances,
    preferredMintUrl,
    mintMethodCapabilities,
    proofAmounts,
  ]);

  return <WalletContextCtx.Provider value={value}>{children}</WalletContextCtx.Provider>;
}
