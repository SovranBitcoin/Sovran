import { useEffect } from 'react';
import { useManagerContext } from '@cashu/coco-react';

import { reconcileSwapLegs } from '@/shared/lib/cashu/reconcileSwapLegs';
import { cashuLog, redactError } from '@/shared/lib/logger';

/**
 * Keeps saved swap legs honest after their run has ended: once when the wallet
 * opens, and again whenever Coco finalizes a mint or settles a melt, a leg left
 * settling or payment-pending is checked against its own operations.
 */
export function useSwapLegReconciler(): void {
  const { manager } = useManagerContext();

  useEffect(() => {
    if (!manager) return;
    const run = () => {
      reconcileSwapLegs(manager).catch((error: unknown) => {
        cashuLog.warn('swap.reconcile.failed', { error: redactError(error) });
      });
    };
    run();
    const offs = [
      manager.on('mint-op:finalized', run),
      manager.on('melt-op:finalized', run),
      manager.on('melt-op:rolled-back', run),
    ];
    return () => offs.forEach((off) => off());
  }, [manager]);
}
