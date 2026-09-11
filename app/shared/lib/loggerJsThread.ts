// ═══════════════════════════════════════════════════════════════════════════════
// JS Thread Blocking Detector
// ═══════════════════════════════════════════════════════════════════════════════
//
// Fires a setTimeout heartbeat every `intervalMs`. If the callback fires later
// than `thresholdMs` past its scheduled time, the JS thread was blocked for that
// duration. Logs a warning so you can correlate it with whatever operation was
// running (recovery, crypto derivation, etc.).
//
// Active only when SHOW_LOGS is on (gated to IS_DEV at module load) — no
// production overhead. Importing this module from the public logger barrel
// arms the monitor only with EXPO_PUBLIC_JS_THREAD_MONITOR=1.

import { log, monotonicNow, SHOW_LOGS } from './loggerCore';

let _heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Start the JS thread heartbeat monitor. Opted into below for profiling builds.
 *
 * @param intervalMs How often to check (default 200ms — low overhead)
 * @param thresholdMs Block duration that triggers a warning (default 100ms)
 * @returns A stop function to disable the monitor
 */
function startJSThreadMonitor(intervalMs = 200, thresholdMs = 100): () => void {
  if (_heartbeatTimer !== null) return () => {};

  let lastTick = monotonicNow();

  function tick() {
    const now = monotonicNow();
    const elapsed = now - lastTick;
    const blocked = elapsed - intervalMs;

    if (blocked > thresholdMs) {
      log.warn('perf.js_thread_blocked', {
        blocked_ms: Math.round(blocked * 100) / 100,
        expected_ms: intervalMs,
        actual_ms: Math.round(elapsed * 100) / 100,
      });
    }

    lastTick = now;
    _heartbeatTimer = setTimeout(tick, intervalMs);
  }

  _heartbeatTimer = setTimeout(tick, intervalMs);

  return () => {
    if (_heartbeatTimer !== null) {
      clearTimeout(_heartbeatTimer);
      _heartbeatTimer = null;
    }
  };
}

// Opt in with EXPO_PUBLIC_JS_THREAD_MONITOR=1. Capture the stop function so consumers
// can disable the monitor — the previous implementation discarded it, leaving
// no way to pause the heartbeat (audit 56 F-016).
let _heartbeatStop: (() => void) | null = null;
let _heartbeatBootstrap: ReturnType<typeof setTimeout> | null = null;
const IS_JEST_RUNTIME = typeof process !== 'undefined' && process.env.JEST_WORKER_ID !== undefined;

if (SHOW_LOGS && !IS_JEST_RUNTIME && process.env.EXPO_PUBLIC_JS_THREAD_MONITOR === '1') {
  _heartbeatBootstrap = setTimeout(() => {
    _heartbeatStop = startJSThreadMonitor();
  }, 1000);
}

/** Stop the JS-thread heartbeat. Idempotent. Safe to call before bootstrap. */
export function stopJSThreadMonitor(): void {
  if (_heartbeatBootstrap !== null) {
    clearTimeout(_heartbeatBootstrap);
    _heartbeatBootstrap = null;
  }
  if (_heartbeatStop) {
    _heartbeatStop();
    _heartbeatStop = null;
  }
}
