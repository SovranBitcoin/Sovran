/**
 * App-level balance hook.
 *
 * Wraps coco's useBalanceContext + useMints and returns a single total
 * balance number. When mock mode is active, returns the mock balance instead.
 */

import { useEffect, useMemo, useRef } from 'react';

import { useBalanceContext, useMints } from '@cashu/coco-react';

import { useMockDataStore } from '@/shared/stores/runtime/mockDataStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useShallowMemo } from '@/shared/hooks/useShallowMemo';
import { walletLog } from '@/shared/lib/logger';

export function useAppBalance(): number {
  const mockMode = useSettingsStore((s) => s.mockMode);
  const mockBalance = useMockDataStore((s) => s.mockBalance);
  const { balances: rawBalanceCtx } = useBalanceContext();
  const { mints: rawMints } = useMints();

  // Stabilise coco-react references
  const liveBalances = useShallowMemo(rawBalanceCtx.byMint);

  // Stabilise mints array — only recompute when URLs actually change
  const mintUrls = useMemo(() => rawMints.map((m) => m.mintUrl), [rawMints]);
  const prevMintUrlsRef = useRef(mintUrls);
  const stableMintUrls = useMemo(() => {
    const prev = prevMintUrlsRef.current;
    if (prev.length === mintUrls.length && prev.every((u, i) => u === mintUrls[i])) {
      return prev;
    }
    prevMintUrlsRef.current = mintUrls;
    return mintUrls;
  }, [mintUrls]);

  const total = useMemo(
    () =>
      mockMode
        ? mockBalance
        : stableMintUrls.reduce((sum, url) => sum + (liveBalances[url]?.total || 0), 0),
    [mockMode, mockBalance, liveBalances, stableMintUrls]
  );

  // Notify on transitions in an effect — render-phase side effects (writes to
  // refs, logger calls) re-fire under StrictMode and Suspense retries.
  const prevBalance = useRef<number | null>(null);
  useEffect(() => {
    if (prevBalance.current !== null && prevBalance.current !== total) {
      walletLog.info('wallet.balance.changed', {
        from: prevBalance.current,
        to: total,
        mintCount: stableMintUrls.length,
        mockMode,
      });
    }
    prevBalance.current = total;
  }, [total, stableMintUrls.length, mockMode]);

  return total;
}
