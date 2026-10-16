// ═══════════════════════════════════════════════════════════════════════════════
// UI Thread Frame-Drop Sampler
// ═══════════════════════════════════════════════════════════════════════════════
//
// The JS-thread heartbeat (loggerJsThread) cannot see a slow UI thread: layout,
// native animation and view mounting stall frames while JS stays idle. This runs
// a requestAnimationFrame loop ON the UI thread, compares each frame's gap with
// the display's frame budget, and reports once per second — only for a second
// that actually dropped frames.
//
// The loop keeps the display link awake, which is itself a cost (thermal
// investigation 2026-09-09 §6), so it is opt-in: active only when SHOW_LOGS is
// on AND EXPO_PUBLIC_FRAME_DROP_MONITOR=1. Importing this module from the public
// logger barrel arms it under that flag and does nothing otherwise — Reanimated
// is not even loaded.

import { log, SHOW_LOGS } from './loggerCore';

/** A gap this long is the app being backgrounded, not a run of dropped frames. */
const PAUSE_GAP_MS = 1000;
const REPORT_WINDOW_MS = 1000;

function reportFrameDrops(dropped: number, frames: number, worstMs: number, budgetMs: number) {
  log.warn('perf.frame_drop', {
    dropped,
    frames,
    worst_frame_ms: Math.round(worstMs * 100) / 100,
    budget_ms: Math.round(budgetMs * 100) / 100,
    window_ms: REPORT_WINDOW_MS,
  });
}

/**
 * Start the UI-thread frame sampler. Opted into below for profiling builds.
 *
 * @returns A stop function; the loop ends on its next frame.
 */
function startFrameDropMonitor(): () => void {
  const { makeMutable, runOnJS, runOnUI } =
    require('react-native-reanimated') as typeof import('react-native-reanimated');
  const running = makeMutable(true);

  runOnUI(() => {
    'worklet';
    // The display's real frame interval is not known up front (60 vs 120 Hz),
    // so start from 60 Hz and tighten to the shortest gap actually observed.
    let budget = 1000 / 60;
    let last = 0;
    let windowStart = 0;
    let frames = 0;
    let dropped = 0;
    let worst = 0;

    const onFrame = (timestamp: number) => {
      if (!running.get()) return;
      const gap = last > 0 ? timestamp - last : 0;
      last = timestamp;

      if (gap <= 0 || gap > PAUSE_GAP_MS) {
        // First frame, or a resume from background: open a fresh window.
        windowStart = timestamp;
        frames = 0;
        dropped = 0;
        worst = 0;
      } else {
        if (gap >= 4 && gap < budget) budget = gap;
        frames += 1;
        if (gap > worst) worst = gap;
        if (gap > budget * 1.5) dropped += Math.round(gap / budget) - 1;

        if (timestamp - windowStart >= REPORT_WINDOW_MS) {
          if (dropped > 0) runOnJS(reportFrameDrops)(dropped, frames, worst, budget);
          windowStart = timestamp;
          frames = 0;
          dropped = 0;
          worst = 0;
        }
      }
      requestAnimationFrame(onFrame);
    };
    requestAnimationFrame(onFrame);
  })();

  return () => running.set(false);
}

// Opt in with EXPO_PUBLIC_FRAME_DROP_MONITOR=1. Bootstrapped after a beat, like
// the JS-thread monitor, so it starts sampling once the first screen is up.
let _frameMonitorStop: (() => void) | null = null;
let _frameMonitorBootstrap: ReturnType<typeof setTimeout> | null = null;
const IS_JEST_RUNTIME = typeof process !== 'undefined' && process.env.JEST_WORKER_ID !== undefined;

if (SHOW_LOGS && !IS_JEST_RUNTIME && process.env.EXPO_PUBLIC_FRAME_DROP_MONITOR === '1') {
  _frameMonitorBootstrap = setTimeout(() => {
    _frameMonitorBootstrap = null;
    try {
      _frameMonitorStop = startFrameDropMonitor();
    } catch (error) {
      log.warn('perf.frame_drop.monitor_unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, 1000);
}

/** Stop the frame-drop sampler. Idempotent. Safe to call before bootstrap. */
export function stopFrameDropMonitor(): void {
  if (_frameMonitorBootstrap !== null) {
    clearTimeout(_frameMonitorBootstrap);
    _frameMonitorBootstrap = null;
  }
  if (_frameMonitorStop) {
    _frameMonitorStop();
    _frameMonitorStop = null;
  }
}
