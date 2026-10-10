// ═══════════════════════════════════════════════════════════════════════════════
// TIMED DERIVE — one warning when a synchronous derivation runs over its budget
// ═══════════════════════════════════════════════════════════════════════════════
//
// For selectors and list transforms (a filter, a sort, a grouping) that run in a
// memo. The derivation is returned untouched; when it takes longer than
// `thresholdMs` one `event` warning carries `duration_ms` plus whatever `params`
// reports about the result. `params` is a thunk and is resolved only for an
// entry that is kept, so counting the output costs nothing on the fast path.

import { monotonicNow, type Logger } from './loggerCore';

interface TimedDeriveOptions<T> {
  /** Event name, e.g. `transactions.filter.slow`. */
  event: string;
  logger: Logger;
  /** Budget in milliseconds; only a run strictly over it is reported. */
  thresholdMs: number;
  /** Fields describing the run (input and output sizes). Never the data itself. */
  params?: (result: T) => Record<string, unknown>;
}

/**
 * Run `derive` and return its result, warning when it exceeds the budget. A
 * logger that would drop the warning skips the clock too, so a release build
 * pays only the call.
 */
export function timedDerive<T>(options: TimedDeriveOptions<T>, derive: () => T): T {
  const { event, logger, thresholdMs, params } = options;
  if (!logger.isLevelEnabled('warn')) return derive();
  const startedAt = monotonicNow();
  const result = derive();
  const duration = Math.round((monotonicNow() - startedAt) * 100) / 100;
  if (duration > thresholdMs) {
    logger.warn(event, () => ({ duration_ms: duration, ...params?.(result) }));
  }
  return result;
}
