// ═══════════════════════════════════════════════════════════════════════════════
// InteractionManager Scheduler with JS-Thread-Block Detection
// ═══════════════════════════════════════════════════════════════════════════════

import { log } from './loggerCore';

/**
 * Schedule work via InteractionManager with JS-thread-block detection.
 *
 * In React Native, InteractionManager.runAfterInteractions() fires immediately
 * when no animations are registered, and setTimeout callbacks are delayed when
 * the JS thread is blocked. This helper logs the *intended* vs *actual* delay
 * so frozen-thread issues show up clearly in log-doctor's timeline.
 */
export function deferWork(label: string, work: () => void, delayMs = 0): { cancel: () => void } {
  const scheduled = performance.now();
  let cancelled = false;
  let interactionHandle: { cancel: () => void } | null = null;

  const timer = setTimeout(() => {
    if (cancelled) return;
    const { InteractionManager } = require('react-native');
    interactionHandle = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      const actual = performance.now();
      const drift = Math.round((actual - scheduled - delayMs) * 100) / 100;
      if (drift > 500) {
        log.warn('perf.defer.drift', { label, intended_ms: delayMs, drift_ms: drift });
      }
      const t0 = performance.now();
      work();
      const duration = Math.round((performance.now() - t0) * 100) / 100;
      if (duration > 100) {
        log.warn('perf.defer.slow_work', { label, duration_ms: duration });
      }
    });
  }, delayMs);

  return {
    cancel: () => {
      cancelled = true;
      clearTimeout(timer);
      interactionHandle?.cancel();
    },
  };
}
