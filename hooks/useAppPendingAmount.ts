/**
 * @fileoverview App-level pending ecash hook
 *
 * Wraps the pending send calculation from `usePaginatedHistory` and returns
 * the total pending ecash amount. When mock mode is active, returns the mock
 * pending amount instead.
 */

import { useMemo } from 'react';
import { usePaginatedHistory } from 'coco-cashu-react';
import type { SendHistoryEntry } from 'coco-cashu-core';
import { useSettingsStore } from 'stores/settingsStore';
import { useMockDataStore } from 'stores/mockDataStore';

interface PendingEcash {
  totalAmount: number;
  unit: string;
  count: number;
}

export function useAppPendingAmount(): PendingEcash {
  const mockMode = useSettingsStore((s) => s.mockMode);
  const mockPendingAmount = useMockDataStore((s) => s.mockPendingAmount);
  const { history } = usePaginatedHistory();

  return useMemo(() => {
    if (mockMode) {
      return { totalAmount: mockPendingAmount, unit: 'sat', count: 1 };
    }

    const pendingSends = history.filter(
      (entry): entry is SendHistoryEntry =>
        entry.type === 'send' && (entry.state === 'pending' || entry.state === 'prepared')
    );

    const totalAmount = pendingSends.reduce((sum, tx) => sum + tx.amount, 0);
    const unit = pendingSends[0]?.unit || 'sat';

    return { totalAmount, unit, count: pendingSends.length };
  }, [mockMode, mockPendingAmount, history]);
}
