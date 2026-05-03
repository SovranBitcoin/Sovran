import { useEffect, useState } from 'react';
import { useManager } from '@cashu/coco-react';
import type { CoreProof } from '@cashu/coco-core';
import { getReservedProofs } from 'coco-payment-ux';

import { useLatestRef } from '@/shared/hooks/useLatestRef';
import { walletLog } from '@/shared/lib/logger';

export interface ReservedProofsResult {
  reservedTotal: number;
  reservedProofs: CoreProof[];
}

export function useReservedProofs(): ReservedProofsResult {
  const manager = useManager();
  const [reservedTotal, setReservedTotal] = useState(0);
  const [reservedProofs, setReservedProofs] = useState<CoreProof[]>([]);

  const managerRef = useLatestRef(manager);

  useEffect(() => {
    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    async function loadReserved() {
      try {
        const proofs = await getReservedProofs(managerRef.current);
        if (cancelled) return;
        const total = proofs.reduce((sum, proof) => sum + proof.amount, 0);
        walletLog.info('reservedProofs.loaded', { count: proofs.length, total });
        setReservedTotal(total);
        setReservedProofs(proofs);
      } catch (err) {
        if (cancelled) return;
        walletLog.error('reservedProofs.error', { error: err });
        setReservedTotal(0);
        setReservedProofs([]);
      }
    }

    // Debounce event-driven reloads — coco fires multiple proof events in
    // quick succession during operations. Wait 150ms for them to settle.
    function scheduleLoad() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(loadReserved, 150);
    }

    // Initial load (no debounce)
    loadReserved();

    manager.on('proofs:reserved', scheduleLoad);
    manager.on('proofs:released', scheduleLoad);
    manager.on('proofs:state-changed', scheduleLoad);

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      manager.off('proofs:reserved', scheduleLoad);
      manager.off('proofs:released', scheduleLoad);
      manager.off('proofs:state-changed', scheduleLoad);
    };
  }, [manager]);

  return { reservedTotal, reservedProofs };
}
