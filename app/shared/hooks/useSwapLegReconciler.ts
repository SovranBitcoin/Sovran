import { useEffect } from 'react';
import { useManagerContext } from '@cashu/coco-react';

import { createSwapLegReconciler } from '@/shared/lib/cashu/reconcileSwapLegs';

/**
 * Keeps saved swap legs honest after their run has ended: once when the wallet
 * opens, and again whenever Coco finalizes a mint or settles a melt, a leg left
 * without a known outcome is checked against its own operations.
 */
export function useSwapLegReconciler(): void {
  const { manager } = useManagerContext();

  useEffect(() => {
    if (!manager) return;
    const reconciler = createSwapLegReconciler(manager);
    reconciler.run();
    const offs = [
      manager.on('mint-op:finalized', reconciler.run),
      manager.on('melt-op:finalized', reconciler.run),
      manager.on('melt-op:rolled-back', reconciler.run),
    ];
    return () => {
      reconciler.stop();
      offs.forEach((off) => off());
    };
  }, [manager]);
}
