import { useEffect, useState } from 'react';
import { useManager } from '@cashu/coco-react';
import type { CoreProof } from '@cashu/coco-core';
import { getReservedProofs } from '@/shared/lib/cashu/managerInternals';
import { amountToNumber } from '@/shared/lib/cashu/amount';

import { useLatestRef } from '@/shared/hooks/useLatestRef';
import { walletLog } from '@/shared/lib/logger';

interface ReservedProofsResult {
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

    async function loadReserved(reason: string) {
      try {
        walletLog.debug('reservedProofs.load.start', { reason });
        const proofs = await getReservedProofs(managerRef.current);
        if (cancelled) {
          walletLog.debug('reservedProofs.load.stale_result', { reason });
          return;
        }
        const total = proofs.reduce((sum, proof) => sum + amountToNumber(proof.amount), 0);
        walletLog.info('reservedProofs.loaded', { reason, count: proofs.length, total });
        setReservedTotal(total);
        setReservedProofs(proofs);
      } catch (err) {
        if (cancelled) {
          walletLog.debug('reservedProofs.error.stale_result', { reason });
          return;
        }
        walletLog.error('reservedProofs.error', { reason, error: err });
        setReservedTotal(0);
        setReservedProofs([]);
      }
    }

    // Debounce event-driven reloads — coco fires multiple proof events in
    // quick succession during operations. Wait 150ms for them to settle.
    function scheduleLoad(reason: string) {
      if (debounceTimer) clearTimeout(debounceTimer);
      walletLog.debug('reservedProofs.load.scheduled', { reason, debounceMs: 150 });
      debounceTimer = setTimeout(() => loadReserved(reason), 150);
    }

    // Initial load (no debounce)
    void loadReserved('initial');

    const onReserved = () => {
      walletLog.debug('reservedProofs.event_received', { event: 'proofs:reserved' });
      scheduleLoad('proofs:reserved');
    };
    const onReleased = () => {
      walletLog.debug('reservedProofs.event_received', { event: 'proofs:released' });
      scheduleLoad('proofs:released');
    };
    const onStateChanged = () => {
      walletLog.debug('reservedProofs.event_received', { event: 'proofs:state-changed' });
      scheduleLoad('proofs:state-changed');
    };

    walletLog.debug('reservedProofs.subscribe');
    manager.on('proofs:reserved', onReserved);
    manager.on('proofs:released', onReleased);
    manager.on('proofs:state-changed', onStateChanged);

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      walletLog.debug('reservedProofs.unsubscribe');
      manager.off('proofs:reserved', onReserved);
      manager.off('proofs:released', onReleased);
      manager.off('proofs:state-changed', onStateChanged);
    };
  }, [manager]);

  return { reservedTotal, reservedProofs };
}
