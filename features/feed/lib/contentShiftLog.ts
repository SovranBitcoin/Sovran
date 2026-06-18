/**
 * @fileoverview Content-shift instrumentation for feed / thread / reply surfaces.
 *
 * "Content shift" = a visible layout jump: a skeleton swapping to real content,
 * an image resolving its true aspect ratio after a 16:9 placeholder, a note body
 * reflowing when async profiles / quotes / metrics arrive, a sticky reply bar
 * growing on focus. These are the hardest UI bugs to reason about after the fact
 * because the jump is gone by the time you look.
 *
 * `useShiftLogger` gives every instrumented surface one change-gated reporter:
 * it remembers the last measured value per key and only emits when the value
 * actually changes, tagging each entry with `prev`, `delta`, and `firstMeasure`
 * so a log reader can tell a real shift (`firstMeasure: false`, non-zero
 * `delta`) from a harmless initial layout (`firstMeasure: true`).
 *
 * Query the resulting timeline with log-doctor, e.g.
 *   npx tsx codereview/log-doctor/index.ts timeline --event 'shift\\.' --latest
 * All shift events live under the `feed` logger module so one filter catches the
 * feed, thread, reply-bar, and composer surfaces together.
 *
 * Dev-only: `feedLog` (like every Sovran logger) short-circuits in production.
 */
import { useCallback, useRef } from 'react';

import { feedLog } from '@/shared/lib/logger';

/** Sub-pixel layout deltas are noise from rounding, not a visible shift. */
const SHIFT_EPSILON = 0.5;

export interface ShiftReporter {
  /**
   * Report a measured numeric value (height, aspect ratio, padding, …) for
   * `key`. Logs `event` only when the value changed from the last one seen for
   * that key. `extra` is merged into the log params for surface-specific
   * context (event id, url host, focused state, …).
   */
  report(event: string, key: string, value: number, extra?: Record<string, unknown>): void;
}

/**
 * Returns a stable {@link ShiftReporter} for a component. Keep one per mounted
 * component (the per-key last-value memory lives in a ref, so a recycled list
 * row keeps comparing against the value it last rendered for that key).
 */
export function useShiftLogger(component: string): ShiftReporter {
  const lastRef = useRef<Map<string, number>>(new Map());

  const report = useCallback<ShiftReporter['report']>(
    (event, key, value, extra) => {
      if (!Number.isFinite(value)) return;
      const prev = lastRef.current.get(key);
      const firstMeasure = prev === undefined;
      if (!firstMeasure && Math.abs((prev as number) - value) < SHIFT_EPSILON) return;
      lastRef.current.set(key, value);
      feedLog.info(event, {
        component,
        key,
        value: round(value),
        prev: firstMeasure ? null : round(prev as number),
        delta: firstMeasure ? null : round(value - (prev as number)),
        firstMeasure,
        ...extra,
      });
    },
    [component]
  );

  return { report };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The host of a media URL, for log context without leaking the full URL. */
export function urlHost(url: string): string {
  const match = url.match(/^[a-z]+:\/\/([^/]+)/i);
  return match ? match[1] : 'unknown';
}
