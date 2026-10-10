/**
 * @jest-environment node
 *
 * `timedDerive` wraps a selector or list transform. It must be invisible to the
 * caller — same result, same throw — and say something only when the run went
 * over its budget.
 */

import { createLogger } from '@/shared/lib/logger';
import { timedDerive } from '@/shared/lib/loggerTimedDerive';

function setup(level: 'debug' | 'error' = 'debug') {
  const logger = createLogger({ level, async: false, transports: [], pretty: false });
  const warnings = () => logger.getRecentLogs().filter((entry) => entry.event === 'list.slow');
  return { logger, warnings };
}

/** Burn wall-clock time so the run is measurably over a small budget. */
function spin(ms: number): void {
  const until = performance.now() + ms;
  while (performance.now() < until);
}

describe('timedDerive', () => {
  it('returns the derivation result unchanged', () => {
    const { logger } = setup();
    const result = { rows: [1, 2, 3] };

    expect(timedDerive({ event: 'list.slow', logger, thresholdMs: 1000 }, () => result)).toBe(
      result
    );
  });

  it('stays quiet and never resolves params for a run within budget', () => {
    const { logger, warnings } = setup();
    const params = jest.fn(() => ({ output: 0 }));

    timedDerive({ event: 'list.slow', logger, thresholdMs: 60_000, params }, () => []);

    expect(warnings()).toEqual([]);
    expect(params).not.toHaveBeenCalled();
  });

  it('warns once with the duration and the described result when over budget', () => {
    const { logger, warnings } = setup();

    const rows = timedDerive(
      {
        event: 'list.slow',
        logger,
        thresholdMs: 1,
        params: (result: number[]) => ({ input: 5, output: result.length }),
      },
      () => {
        spin(5);
        return [1, 2];
      }
    );

    expect(rows).toEqual([1, 2]);
    expect(warnings()).toHaveLength(1);
    const [warning] = warnings();
    expect(warning!.level).toBe('warn');
    expect(warning!.params).toMatchObject({ input: 5, output: 2 });
    expect((warning!.params as { duration_ms: number }).duration_ms).toBeGreaterThan(1);
  });

  it('lets a throwing derivation throw', () => {
    const { logger, warnings } = setup();

    expect(() =>
      timedDerive({ event: 'list.slow', logger, thresholdMs: 0 }, () => {
        throw new Error('derive boom');
      })
    ).toThrow('derive boom');
    expect(warnings()).toEqual([]);
  });

  it('still runs the derivation when the logger would drop the warning', () => {
    const { logger, warnings } = setup('error');
    const params = jest.fn(() => ({}));

    const result = timedDerive({ event: 'list.slow', logger, thresholdMs: 0, params }, () => {
      spin(2);
      return 'done';
    });

    expect(result).toBe('done');
    expect(warnings()).toEqual([]);
    expect(params).not.toHaveBeenCalled();
  });
});
