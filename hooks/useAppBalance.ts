/**
 * App-level balance hook.
 *
 * Wraps coco's useBalanceContext + useMints and returns a single total
 * balance number. When mock mode is active, returns the mock balance instead.
 */

import { useMemo } from 'react';

import { useBalanceContext, useMints } from 'coco-cashu-react';

import { useMockDataStore } from 'stores/mockDataStore';
import { useSettingsStore } from 'stores/settingsStore';

export function useAppBalance(): number {
  const mockMode = useSettingsStore((s) => s.mockMode);
  const mockBalance = useMockDataStore((s) => s.mockBalance);
  const { balance: liveBalances } = useBalanceContext();
  const { mints } = useMints();

  return useMemo(() => {
    if (mockMode) return mockBalance;
    return mints.reduce((total, mint) => total + (liveBalances[mint.mintUrl] || 0), 0);
  }, [mockMode, mockBalance, liveBalances, mints]);
}
