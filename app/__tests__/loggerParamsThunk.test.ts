/**
 * @jest-environment node
 *
 * `emit` short-circuits on `SHOW_LOGS`, on `enabled`, and on the level
 * threshold — but the CALLER still evaluates whatever it passes. A params
 * thunk is resolved only AFTER those gates, so an entry that is dropped never
 * pays for the scans that would have built it.
 */

import { createLogger } from '@/shared/lib/logger';

describe('Logger params thunk', () => {
  function isolated(level: 'debug' | 'warn') {
    return createLogger({ level, async: false, transports: [], pretty: false });
  }

  it('does not resolve the thunk for an entry below the level threshold', () => {
    const logger = isolated('warn');
    const dropped = jest.fn(() => ({ scanned: 1 }));

    logger.debug('below.threshold', dropped);

    expect(dropped).not.toHaveBeenCalled();
    expect(logger.getRecentLogs().some((e) => e.event === 'below.threshold')).toBe(false);
  });

  it('resolves it exactly once for an entry that is kept, and logs the result', () => {
    const logger = isolated('debug');
    const kept = jest.fn(() => ({ scanned: 2 }));

    logger.warn('above.threshold', kept);

    expect(kept).toHaveBeenCalledTimes(1);
    const entry = logger.getRecentLogs().find((e) => e.event === 'above.threshold');
    expect(entry?.params).toMatchObject({ scanned: 2 });
  });

  it('still accepts a plain object, so no existing call site has to change', () => {
    const logger = isolated('debug');
    logger.info('plain.params', { count: 3 });
    expect(logger.getRecentLogs().find((e) => e.event === 'plain.params')?.params).toMatchObject({
      count: 3,
    });
  });

  it('stops resolving once the level is raised at runtime', () => {
    const logger = isolated('debug');
    const thunk = jest.fn(() => ({ scanned: 4 }));

    logger.debug('first', thunk);
    logger.setLevel('error');
    logger.debug('second', thunk);

    expect(thunk).toHaveBeenCalledTimes(1);
  });
});
