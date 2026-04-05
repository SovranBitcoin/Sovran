import { useEffect, useRef, useState } from 'react';
import { useManager } from '@cashu/coco-react';
import type { CoreProof } from '@cashu/coco-core';

import { walletLog } from '@/shared/lib/logger';

type UnsafeManager = {
  proofRepository?: {
    getReservedProofs?: () => Promise<CoreProof[]>;
  };
};

export interface ReservedProofsResult {
  reservedTotal: number;
  reservedProofs: (CoreProof & { usedByOperationId?: string })[];
}

export function useReservedProofs(): ReservedProofsResult {
  const manager = useManager();
  const [reservedTotal, setReservedTotal] = useState(0);
  const [reservedProofs, setReservedProofs] = useState<
    (CoreProof & { usedByOperationId?: string })[]
  >([]);

  const managerRef = useRef(manager);
  managerRef.current = manager;

  useEffect(() => {
    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    async function loadReserved() {
      const repo = (managerRef.current as unknown as UnsafeManager).proofRepository;
      if (!repo?.getReservedProofs) {
        setReservedTotal(0);
        setReservedProofs([]);
        return;
      }

      try {
        const proofs = await repo.getReservedProofs();
        if (cancelled) return;
        const total = proofs.reduce((sum, proof) => sum + proof.amount, 0);
        walletLog.info('reservedProofs.loaded', { count: proofs.length, total });
        setReservedTotal(total);
        setReservedProofs(proofs as (CoreProof & { usedByOperationId?: string })[]);
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
