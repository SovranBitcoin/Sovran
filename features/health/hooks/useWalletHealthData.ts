import { useCallback, useMemo, useRef } from 'react';

import type { HistoryEntry, SendHistoryEntry } from '@cashu/coco-core';
import { useBalanceContext, useMints, usePaginatedHistory } from '@cashu/coco-react';

import { useMintDistributionStore } from '@/shared/stores/profile/mintDistributionStore';
import { useShallowMemo } from '@/shared/hooks/useShallowMemo';
import { walletLog } from '@/shared/lib/logger';

import { getMintsForUnit } from '../lib/walletHealth';

const EMPTY_DISTRIBUTION: Record<string, number> = {};

/**
 * Shared data inputs for wallet health computation.
 * Both WalletHealthCard and WalletHealthModalContent need the same
 * per-unit mints, balances, distributions, and pending counts.
 */
export function useWalletHealthData(unit: string) {
  const { trustedMints } = useMints();
  const { balances: rawBalanceCtx } = useBalanceContext();
  const rawBalance = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(rawBalanceCtx.byMint).map(([url, snap]) => [url, snap.total])
      ) as Record<string, number>,
    [rawBalanceCtx]
  );
  const { history } = usePaginatedHistory();

  const normalizedUnit = unit.toLowerCase();

  // Only subscribe to this unit's distribution, not all distributions
  const desiredDistributionBp = useMintDistributionStore(
    useCallback((s) => s.distributions[normalizedUnit] || EMPTY_DISTRIBUTION, [normalizedUnit])
  );

  // Stabilise balance reference from coco-react
  const balance = useShallowMemo(rawBalance);

  const mintsForUnit = useMemo(
    () => getMintsForUnit(trustedMints, normalizedUnit),
    [trustedMints, normalizedUnit]
  );

  const mintUrlsForUnit = useMemo(() => mintsForUnit.map((m) => m.mintUrl), [mintsForUnit]);

  const pendingOutgoingCount = useMemo(() => {
    return history.filter((entry: HistoryEntry) => {
      if (entry.type !== 'send') return false;
      const send = entry as SendHistoryEntry;
      return (
        (send.state === 'pending' || send.state === 'prepared') &&
        (send.unit?.toLowerCase() || 'sat') === normalizedUnit
      );
    }).length;
  }, [history, normalizedUnit]);

  // Only log when values actually change
  const prevLogRef = useRef<string>('');
  const logKey = `${normalizedUnit}:${mintUrlsForUnit.length}:${pendingOutgoingCount}`;
  if (logKey !== prevLogRef.current) {
    prevLogRef.current = logKey;
    walletLog.debug('health.data.computed', {
      unit: normalizedUnit,
      mintCount: mintUrlsForUnit.length,
      pendingOutgoingCount,
      hasDistribution: Object.values(desiredDistributionBp).some((v) => (v || 0) > 0),
    });
  }

  return {
    normalizedUnit,
    balance,
    mintUrlsForUnit,
    desiredDistributionBp,
    pendingOutgoingCount,
  };
}
