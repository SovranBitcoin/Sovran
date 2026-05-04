import { createLogger, stopJSThreadMonitor } from '@/shared/lib/logger';

describe('logger child sharing (audit 56.json F-003 / F-006 / F-009 / F-013)', () => {
  function makeIsolated() {
    return createLogger({
      level: 'debug',
      async: false,
      transports: [],
      pretty: false,
    });
  }

  it('child entries land in the parent ring buffer (F-003)', () => {
    const root = makeIsolated();
    const child = root.child({ module: 'cashu' });
    child.warn('cashu.swap.start', { amount: 5 });
    const entries = root.getRecentLogs();
    expect(entries.some((e) => e.event === 'cashu.swap.start' && e.ctx?.module === 'cashu')).toBe(
      true
    );
  });

  it('parent.setLevel propagates to children (F-009 / F-013)', () => {
    const root = makeIsolated();
    const child = root.child({ module: 'nostr' });
    root.setLevel('error');
    child.warn('should.drop');
    child.debug('also.drop');
    const events = root.getRecentLogs().map((e) => e.event);
    expect(events).not.toContain('should.drop');
    expect(events).not.toContain('also.drop');
    root.setLevel('debug');
    child.warn('should.land');
    expect(root.getRecentLogs().map((e) => e.event)).toContain('should.land');
  });

  it('device info attaches once across parent + many children (F-006)', () => {
    const root = makeIsolated();
    const a = root.child({ module: 'a' });
    const b = root.child({ module: 'b' });
    const c = root.child({ module: 'c' });
    a.warn('a.first');
    b.warn('b.first');
    c.warn('c.first');
    root.warn('root.next');
    const withDevice = root.getRecentLogs().filter((e) => !!e.device);
    expect(withDevice.length).toBe(1);
  });

  it('child shares transports with parent (F-009)', () => {
    const seen: string[] = [];
    const root = createLogger({
      level: 'debug',
      async: false,
      transports: [(e) => seen.push(e.event)],
      pretty: false,
    });
    const child = root.child({ module: 'pay' });
    child.warn('child.event');
    root.warn('root.event');
    expect(seen).toEqual(expect.arrayContaining(['child.event', 'root.event']));
  });
});

describe('logger production-safety hygiene (audit 56.json F-002 / F-007 / F-016 / F-017 / F-019)', () => {
  it('surfaces transport throws via console.error instead of swallowing them (F-017)', () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const log = createLogger({
        level: 'debug',
        async: false,
        transports: [
          () => {
            throw new Error('boom');
          },
        ],
        pretty: false,
      });
      log.warn('transport.test');
      const matched = consoleErrorSpy.mock.calls.some(
        (call) =>
          call[0] === '[logger.transport-error]' &&
          call[1] === 'transport.test' &&
          typeof call[2] === 'string' &&
          call[2].includes('boom')
      );
      expect(matched).toBe(true);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('does not extract non-standard Error keys into error.properties (F-019)', () => {
    const captured: { error?: { properties?: unknown; name: string; message: string } }[] = [];
    const log = createLogger({
      level: 'debug',
      async: false,
      transports: [(e) => captured.push(e)],
      pretty: false,
    });
    type LeakyError = Error & { headers: Record<string, string>; secret: string };
    const err = new Error('upstream failed') as LeakyError;
    err.headers = { authorization: 'Bearer ZZZ' };
    err.secret = 'should-not-leak';
    log.warn('http.error', { err });
    expect(captured).toHaveLength(1);
    const entry = captured[0];
    expect(entry.error?.name).toBe('Error');
    expect(entry.error?.message).toBe('upstream failed');
    expect(entry.error).not.toHaveProperty('properties');
    // The leaky keys must not appear anywhere on the entry payload.
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('should-not-leak');
    expect(serialized).not.toContain('Bearer ZZZ');
  });

  it('exports stopJSThreadMonitor and is idempotent (F-002 / F-007 / F-016)', () => {
    // Calling stop in any state must succeed and remain safe to call again.
    expect(typeof stopJSThreadMonitor).toBe('function');
    expect(() => stopJSThreadMonitor()).not.toThrow();
    expect(() => stopJSThreadMonitor()).not.toThrow();
  });
});
