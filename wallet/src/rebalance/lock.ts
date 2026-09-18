import type { RebalanceClock, RebalanceLock } from './types';

const POLL_INTERVAL_MS = 100;
const DEFAULT_MAX_WAIT_MS = 30_000;

export const defaultRebalanceClock: RebalanceClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Serializes rebalance transfers. Coco melt operations are stateful (proof
 * selection, inflight tracking), so two transfers must never prepare or
 * execute at the same time. A waiter polls until the holder releases or its
 * deadline passes.
 */
export function createRebalanceLock(clock: RebalanceClock = defaultRebalanceClock): RebalanceLock {
  let held = false;
  return {
    async acquire(maxWaitMs = DEFAULT_MAX_WAIT_MS) {
      const start = clock.now();
      while (held) {
        if (clock.now() - start > maxWaitMs) return false;
        await clock.sleep(POLL_INTERVAL_MS);
      }
      held = true;
      return true;
    },
    release() {
      held = false;
    },
  };
}
