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
import { walletLog } from '@/shared/lib/logger';

export function useAppBalance(): number {
  const mockMode = useSettingsStore((s) => s.mockMode);
  const mockBalance = useMockDataStore((s) => s.mockBalance);
  const { balance: liveBalances } = useBalanceContext();
  const { mints } = useMints();
  const prevBalance = useRef<number | null>(null);

  return useMemo(() => {
    const total = mockMode
      ? mockBalance
      : mints.reduce((sum, mint) => sum + (liveBalances[mint.mintUrl] || 0), 0);
    if (prevBalance.current !== null && prevBalance.current !== total) {
      walletLog.info('wallet.balance.changed', {
        from: prevBalance.current,
        to: total,
        mintCount: mints.length,
        mockMode,
      });
    }
    prevBalance.current = total;
    return total;
  }, [mockMode, mockBalance, liveBalances, mints]);
}
