// Dev-only idle-work counters: one `if` in a release build. With
// EXPO_PUBLIC_IDLE_COUNTERS=1 a dev build also counts every JS timer callback
// and logs the totals once a minute as `perf.idle_counters`.
import { log, SHOW_LOGS } from './loggerCore';

type IdleCounter =
  | 'timer.fired'
  | 'secure_vault.read'
  | 'wallet_projection.query'
  | 'store.write'
  | 'nearby_payments.drain'
  | 'wallpaper.spring';

const COUNTING = typeof __DEV__ !== 'undefined' && __DEV__;
const counts = new Map<IdleCounter, number>();

export function countIdleWork(counter: IdleCounter, by = 1): void {
  if (COUNTING) counts.set(counter, (counts.get(counter) ?? 0) + by);
}
export const readIdleCounters = () => Object.fromEntries(counts);
export const resetIdleCounters = () => counts.clear();

let timersCounted = false;
/** Count each global timer callback that fires. Idempotent. */
export function countTimerCallbacks(): void {
  if (!COUNTING || timersCounted) return;
  timersCounted = true;
  for (const name of ['setTimeout', 'setInterval'] as const) {
    const schedule = globalThis[name] as (...args: unknown[]) => unknown;
    (globalThis as Record<string, unknown>)[name] = (callback: unknown, ...rest: unknown[]) =>
      schedule(
        typeof callback === 'function'
          ? (...args: unknown[]) => (countIdleWork('timer.fired'), callback(...args))
          : callback,
        ...rest
      );
  }
}

if (
  SHOW_LOGS &&
  COUNTING &&
  !process.env.JEST_WORKER_ID &&
  process.env.EXPO_PUBLIC_IDLE_COUNTERS === '1'
) {
  countTimerCallbacks();
  setInterval(() => {
    const perMinute = readIdleCounters();
    resetIdleCounters();
    log.info('perf.idle_counters', { per_minute: perMinute });
  }, 60_000);
}
