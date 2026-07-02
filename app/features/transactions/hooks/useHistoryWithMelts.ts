import { useMemo } from 'react';
import { useColadaTransactions } from 'wallet/react';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useMockDataStore } from '@/shared/stores/runtime/mockDataStore';

/**
 * Wallet transaction history for the app's lists.
 *
 * The merge of coco history + v3 melt operations + received-but-unredeemed
 * (executing) ecash now lives in colada (`useColadaTransactions`), so any
 * colada consumer shares one read model. This hook is a thin Sovran adapter
 * that only layers mock mode on top.
 */
export function useHistoryWithMelts(pageSize = 100, unit?: string) {
  const result = useColadaTransactions(pageSize);
  const mockMode = useSettingsStore((s) => s.mockMode);
  const mockHistory = useMockDataStore((s) => s.mockHistory);

  const history = useMemo(() => {
    const base = mockMode ? mockHistory : result.history;
    // Multi-unit: the wallet view shows one unit at a time. No unit = all.
    if (!unit) return base;
    return base.filter((entry) => (entry.unit ?? 'sat') === unit);
  }, [mockMode, mockHistory, result.history, unit]);

  return useMemo(() => ({ ...result, history }), [result, history]);
}
