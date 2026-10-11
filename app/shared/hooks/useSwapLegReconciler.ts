import { useEffect } from 'react';
import { useManagerContext } from '@cashu/coco-react';

import { reconcileSwapLegs } from '@/shared/lib/cashu/reconcileSwapLegs';
import { cashuLog, redactError } from '@/shared/lib/logger';

/**
 * Keeps saved swap legs honest after their run has ended: once when the wallet
 * opens, and again whenever Coco finalizes a mint or settles a melt, a leg left
 * without a known outcome is checked against its own operations.
 */
export function useSwapLegReconciler(): void {
  const { manager } = useManagerContext();

  useEffect(() => {
    if (!manager) return;
    let active = true;
    let running = false;
    let again = false;
    // One pass at a time; events that land during a pass ask for one more.
    const run = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        do {
          again = false;
          await reconcileSwapLegs(manager);
        } while (again && active);
      } catch (error) {
        cashuLog.warn('swap.reconcile.failed', { error: redactError(error) });
      } finally {
        running = false;
      }
    };
    void run();
    const offs = [
      manager.on('mint-op:finalized', () => void run()),
      manager.on('melt-op:finalized', () => void run()),
      manager.on('melt-op:rolled-back', () => void run()),
    ];
    return () => {
      active = false;
      offs.forEach((off) => off());
    };
  }, [manager]);
}
