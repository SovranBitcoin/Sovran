/**
 * App-level balance hook.
 *
 * Wraps coco's useBalanceContext + useMints and returns a single total
 * balance number. When mock mode is active, returns the mock balance instead.
 */

import { useMemo, useRef } from 'react';

import { useBalanceContext, useMints } from '@cashu/coco-react';

import { useMockDataStore } from '@/shared/stores/runtime/mockDataStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useShallowMemo } from '@/shared/hooks/useShallowMemo';
import { walletLog } from '@/shared/lib/logger';

export function useAppBalance(): number {
  const mockMode = useSettingsStore((s) => s.mockMode);
  const mockBalance = useMockDataStore((s) => s.mockBalance);
  const { balance: rawBalances } = useBalanceContext();
  const { mints: rawMints } = useMints();
  const prevBalance = useRef<number | null>(null);

  // Stabilise coco-react references
  const liveBalances = useShallowMemo(rawBalances);

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

  return useMemo(() => {
    const total = mockMode
      ? mockBalance
      : stableMintUrls.reduce((sum, url) => sum + (liveBalances[url] || 0), 0);
    if (prevBalance.current !== null && prevBalance.current !== total) {
      walletLog.info('wallet.balance.changed', {
        from: prevBalance.current,
        to: total,
        mintCount: stableMintUrls.length,
        mockMode,
      });
    }
    prevBalance.current = total;
    return total;
  }, [mockMode, mockBalance, liveBalances, stableMintUrls]);
}
