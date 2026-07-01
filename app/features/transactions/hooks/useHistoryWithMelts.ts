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
export function useHistoryWithMelts(pageSize = 100) {
  const result = useColadaTransactions(pageSize);
  const mockMode = useSettingsStore((s) => s.mockMode);
  const mockHistory = useMockDataStore((s) => s.mockHistory);

  const history = mockMode ? mockHistory : result.history;

  return useMemo(() => ({ ...result, history }), [result, history]);
}
