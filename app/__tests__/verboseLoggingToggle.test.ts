/**
 * @jest-environment node
 *
 * Turning off verbose logging silences debug/info/warn emissions across the
 * root logger and all child loggers (including render, call-timing and visual
 * layout-shift probes) while keeping error/fatal logs active.
 */
import { applyVerboseLogging, feedLog, log, storeLog } from '@/shared/lib/loggerCore';
import { withCallTiming } from '@/shared/lib/loggerCallTiming';

afterEach(() => {
  applyVerboseLogging(true);
});

describe('applyVerboseLogging', () => {
  it('silences debug/info/warn across root and child loggers while keeping errors enabled', () => {
    applyVerboseLogging(true);
    expect(log.isLevelEnabled('debug')).toBe(true);
    expect(feedLog.isLevelEnabled('info')).toBe(true);
    expect(storeLog.isLevelEnabled('warn')).toBe(true);
    expect(log.isLevelEnabled('error')).toBe(true);

    applyVerboseLogging(false);
    expect(log.isLevelEnabled('debug')).toBe(false);
    expect(log.isLevelEnabled('info')).toBe(false);
    expect(log.isLevelEnabled('warn')).toBe(false);
    expect(feedLog.isLevelEnabled('info')).toBe(false);
    expect(storeLog.isLevelEnabled('warn')).toBe(false);
    expect(log.isLevelEnabled('error')).toBe(true);
    expect(log.isLevelEnabled('fatal')).toBe(true);

    applyVerboseLogging(true);
    expect(log.isLevelEnabled('debug')).toBe(true);
    expect(feedLog.isLevelEnabled('info')).toBe(true);
  });

  it('stops emitting debug timing logs through an already-wrapped call-timing proxy', () => {
    const debugSpy = jest.spyOn(log, 'debug');
    const target = { ops: { ping: (x: number) => x + 1 } };
    applyVerboseLogging(true);
    const timed = withCallTiming(target, {
      event: 'coco.call',
      logger: log,
      namespaces: ['ops'],
    });

    expect(timed.ops.ping(1)).toBe(2);
    expect(debugSpy).toHaveBeenCalledTimes(1);

    debugSpy.mockClear();
    applyVerboseLogging(false);
    expect(timed.ops.ping(2)).toBe(3);
    expect(debugSpy).not.toHaveBeenCalled();
    debugSpy.mockRestore();
  });
});
