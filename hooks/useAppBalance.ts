/**
 * @fileoverview App-level balance hook
 *
 * Wraps coco's `useBalanceContext` + `useMints` and returns a single total
 * balance number. When mock mode is active, returns the mock balance instead.
 */

import { useMemo } from 'react';
import { useBalanceContext, useMints } from 'coco-cashu-react';
import { useSettingsStore } from 'stores/settingsStore';
import { useMockDataStore } from 'stores/mockDataStore';

export function useAppBalance(): number {
  const mockMode = useSettingsStore((s) => s.mockMode);
  const mockBalance = useMockDataStore((s) => s.mockBalance);
  const { balance: liveBalances } = useBalanceContext();
  const { mints } = useMints();

  return useMemo(() => {
    if (mockMode) return mockBalance;

    let total = 0;
    mints.forEach((mint) => {
      total += liveBalances[mint.mintUrl] || 0;
    });
    return total;
  }, [mockMode, mockBalance, liveBalances, mints]);
}
