import { useMemo } from 'react';

import type { HistoryEntry, SendHistoryEntry } from 'coco-cashu-core';
import { useBalanceContext, useMints, usePaginatedHistory } from 'coco-cashu-react';

import { useMintDistributionStore } from '@/shared/stores/profile/mintDistributionStore';

import { getMintsForUnit } from '../lib/walletHealth';

/**
 * Shared data inputs for wallet health computation.
 * Both WalletHealthCard and WalletHealthModalContent need the same
 * per-unit mints, balances, distributions, and pending counts.
 */
export function useWalletHealthData(unit: string) {
  const { trustedMints } = useMints();
  const { balance } = useBalanceContext();
  const { history } = usePaginatedHistory();
  const distributions = useMintDistributionStore((s) => s.distributions);

  const normalizedUnit = unit.toLowerCase();

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

  const desiredDistributionBp = distributions[normalizedUnit] || {};

  return {
    normalizedUnit,
    balance,
    mintUrlsForUnit,
    desiredDistributionBp,
    pendingOutgoingCount,
  };
}
