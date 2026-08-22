import { initPhase, initPhaseSync, log } from '@/shared/lib/logger';

type Entry = { level: string; event: string; params?: Record<string, unknown> };

/** Emits reach the ring buffer on a microtask. */
const flushLogs = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * The logger collapses consecutive same-event `info` emits inside a 50 ms
 * dedup window, so a phase must outlast it for its `end` emit to be observable.
 * `warn` bypasses dedup, so the error paths need no wait.
 */
const DEDUP_WINDOW_MS = 50;
const OUTLAST_DEDUP_MS = DEDUP_WINDOW_MS + 20;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const busyWait = (ms: number) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* spin: initPhaseSync must not yield */
  }
};

function timingEntriesFor(tag: string): Entry[] {
  return (log.getRecentLogs() as Entry[]).filter(
    (e) => e.event === 'init.timing' && e.params?.tag === tag
  );
}

describe('initPhase / initPhaseSync emit one init.timing taxonomy', () => {
  // The dedup window is global to the shared logger, so let it lapse between
  // tests or one test's terminal emit swallows the next test's `start`.
  beforeEach(() => sleep(OUTLAST_DEDUP_MS));

  it('emits start then end for a resolved async phase and returns its value', async () => {
    const result = await initPhase('test.async.ok', async () => {
      await sleep(OUTLAST_DEDUP_MS);
      return 'value';
    });

    expect(result).toBe('value');
    await flushLogs();
    const entries = timingEntriesFor('test.async.ok');
    expect(entries.map((e) => e.params?.msg)).toEqual(['start', 'end']);
    expect(typeof entries[1].params?.durationMs).toBe('number');
    expect(typeof entries[1].params?.offsetMs).toBe('number');
    expect(entries[1].level).toBe('info');
  });

  it('emits start then end for a sync phase and returns its value', async () => {
    const result = initPhaseSync('test.sync.ok', () => {
      busyWait(OUTLAST_DEDUP_MS);
      return 7;
    });

    expect(result).toBe(7);
    await flushLogs();
    expect(timingEntriesFor('test.sync.ok').map((e) => e.params?.msg)).toEqual(['start', 'end']);
  });

  it('emits a warn error entry carrying the message and rethrows (async)', async () => {
    await expect(
      initPhase('test.async.fail', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    await flushLogs();
    const entries = timingEntriesFor('test.async.fail');
    const error = entries.find((e) => e.params?.msg === 'error');
    expect(error?.level).toBe('warn');
    expect(error?.params?.error).toBe('boom');
    expect(typeof error?.params?.durationMs).toBe('number');
    expect(typeof error?.params?.offsetMs).toBe('number');
  });

  it('emits a warn error entry carrying the message and rethrows (sync)', async () => {
    expect(() =>
      initPhaseSync('test.sync.fail', () => {
        throw new Error('bang');
      })
    ).toThrow('bang');

    await flushLogs();
    const error = timingEntriesFor('test.sync.fail').find((e) => e.params?.msg === 'error');
    expect(error?.params?.error).toBe('bang');
  });

  it('stringifies a non-Error throw rather than dropping it', async () => {
    expect(() =>
      initPhaseSync('test.sync.nonerror', () => {
        throw 'plain string';
      })
    ).toThrow('plain string');

    await flushLogs();
    const error = timingEntriesFor('test.sync.nonerror').find((e) => e.params?.msg === 'error');
    expect(error?.params?.error).toBe('plain string');
  });

  it('emits the same error payload keys from the async and sync runners', async () => {
    await expect(
      initPhase('test.parity.async', async () => {
        throw new Error('x');
      })
    ).rejects.toThrow('x');
    expect(() =>
      initPhaseSync('test.parity.sync', () => {
        throw new Error('x');
      })
    ).toThrow('x');

    await flushLogs();
    const keysOf = (tag: string) =>
      Object.keys(
        timingEntriesFor(tag).find((e) => e.params?.msg === 'error')?.params ?? {}
      ).sort();
    expect(keysOf('test.parity.async')).toEqual(keysOf('test.parity.sync'));
    expect(keysOf('test.parity.async')).toEqual(['durationMs', 'error', 'msg', 'offsetMs', 'tag']);
  });
});
