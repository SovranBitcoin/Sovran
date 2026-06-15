import { useEffect, useState } from 'react';
import { useManager } from '@cashu/coco-react';
import type { ReceiveOperation } from '@cashu/coco-core';

import { useLatestRef } from '@/shared/hooks/useLatestRef';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { walletLog } from '@/shared/lib/logger';

interface InFlightReceivesResult {
  /** Sum of amounts of received-but-not-yet-redeemed (executing) receives. */
  lockedTotal: number;
  /** Unit of the locked total (first in-flight receive's unit, defaults sat). */
  lockedUnit: string;
  /** Raw in-flight receive operations (coco state `executing`). */
  receives: ReceiveOperation[];
}

/**
 * Tracks ecash that has been received but not yet redeemed into spendable
 * balance — coco receive operations stuck in the `executing` state because the
 * mint/network was unreachable when the (typically P2PK-locked) token arrived.
 *
 * These funds are invisible to the normal balance (`useAppBalance`, which only
 * counts `ready` proofs) and to the history list (coco only projects
 * `finalized`/`rolled_back` receives), so this hook reads them directly via the
 * public `manager.ops.receive.listInFlight()` API. They are drained when coco's
 * receive recovery sweep runs (on startup, or manually — see PrimaryBalance).
 *
 * Mirrors `useReservedProofs`: initial load + debounced reloads on the relevant
 * coco operation events.
 */
export function useInFlightReceives(): InFlightReceivesResult {
  const manager = useManager();
  const [receives, setReceives] = useState<ReceiveOperation[]>([]);

  const managerRef = useLatestRef(manager);

  useEffect(() => {
    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    async function loadInFlight(reason: string) {
      try {
        walletLog.debug('inFlightReceives.load.start', { reason });
        const ops = await managerRef.current.ops.receive.listInFlight();
        if (cancelled) {
          walletLog.debug('inFlightReceives.load.stale_result', { reason });
          return;
        }
        const total = ops.reduce((sum, op) => sum + amountToNumber(op.amount), 0);
        walletLog.info('inFlightReceives.loaded', { reason, count: ops.length, total });
        setReceives(ops);
      } catch (err) {
        if (cancelled) {
          walletLog.debug('inFlightReceives.error.stale_result', { reason });
          return;
        }
        walletLog.error('inFlightReceives.error', { reason, error: err });
        setReceives([]);
      }
    }

    // Debounce event-driven reloads — a single receive emits prepare then
    // finalize/rolled-back in quick succession; the execute() that flips an op
    // to `executing` lands shortly after `receive-op:prepared`, so a short
    // delay lets the persisted state settle before we re-query.
    function scheduleLoad(reason: string) {
      if (debounceTimer) clearTimeout(debounceTimer);
      walletLog.debug('inFlightReceives.load.scheduled', { reason, debounceMs: 300 });
      debounceTimer = setTimeout(() => loadInFlight(reason), 300);
    }

    // Initial load (no debounce) — picks up receives stranded across restart.
    void loadInFlight('initial');

    const onPrepared = () => scheduleLoad('receive-op:prepared');
    const onFinalized = () => scheduleLoad('receive-op:finalized');
    const onRolledBack = () => scheduleLoad('receive-op:rolled-back');
    // Finalize saves the swapped proofs; refresh so a redeemed op drops off.
    const onProofsSaved = () => scheduleLoad('proofs:saved');

    walletLog.debug('inFlightReceives.subscribe');
    manager.on('receive-op:prepared', onPrepared);
    manager.on('receive-op:finalized', onFinalized);
    manager.on('receive-op:rolled-back', onRolledBack);
    manager.on('proofs:saved', onProofsSaved);

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      walletLog.debug('inFlightReceives.unsubscribe');
      manager.off('receive-op:prepared', onPrepared);
      manager.off('receive-op:finalized', onFinalized);
      manager.off('receive-op:rolled-back', onRolledBack);
      manager.off('proofs:saved', onProofsSaved);
    };
  }, [manager]);

  const lockedTotal = receives.reduce((sum, op) => sum + amountToNumber(op.amount), 0);
  const lockedUnit = receives[0]?.unit ?? 'sat';

  return { lockedTotal, lockedUnit, receives };
}
