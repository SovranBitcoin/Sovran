/**
 * App-level balance hook.
 *
 * The balance breakdown now lives in colada (`useColadaBalance`); this is a
 * thin Sovran adapter that returns the single total and layers mock mode on
 * top. `total` is spendable + reserved (coco's BalanceSnapshot.total).
 */

import { useColadaBalance } from '@sovranbitcoin/colada/react';

import { useMockDataStore } from '@/shared/stores/runtime/mockDataStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';

export function useAppBalance(): number {
  const mockMode = useSettingsStore((s) => s.mockMode);
  const mockBalance = useMockDataStore((s) => s.mockBalance);
  const { total } = useColadaBalance();
  return mockMode ? mockBalance : total;
}
