import { useCallback, useEffect, useState } from 'react';
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

  const loadReserved = useCallback(async () => {
    const repo = (manager as unknown as UnsafeManager).proofRepository;
    if (!repo?.getReservedProofs) {
      walletLog.debug('reservedProofs.noRepo', { available: false });
      setReservedTotal(0);
      setReservedProofs([]);
      return;
    }

    try {
      const proofs = await repo.getReservedProofs();
      const total = proofs.reduce((sum, proof) => sum + proof.amount, 0);
      walletLog.info('reservedProofs.loaded', { count: proofs.length, total });
      setReservedTotal(total);
      setReservedProofs(proofs as (CoreProof & { usedByOperationId?: string })[]);
    } catch (err) {
      walletLog.error('reservedProofs.error', { error: err });
      setReservedTotal(0);
      setReservedProofs([]);
    }
  }, [manager]);

  useEffect(() => {
    loadReserved();

    manager.on('proofs:reserved', loadReserved);
    manager.on('proofs:released', loadReserved);
    manager.on('proofs:state-changed', loadReserved);

    return () => {
      manager.off('proofs:reserved', loadReserved);
      manager.off('proofs:released', loadReserved);
      manager.off('proofs:state-changed', loadReserved);
    };
  }, [manager, loadReserved]);

  return { reservedTotal, reservedProofs };
}
