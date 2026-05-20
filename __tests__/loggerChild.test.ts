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

describe('logger redaction safety (audit 56.json F-001 / F-008 / F-012)', () => {
  function captureLog() {
    const captured: { event: string; params?: Record<string, unknown> }[] = [];
    const log = createLogger({
      level: 'debug',
      async: false,
      transports: [(e) => captured.push({ event: e.event, params: e.params })],
      pretty: false,
      // Force string summarization on inputs over 8 chars so the regression
      // test stays small. Default 120 would require artificially long inputs.
      maxStringLength: 8,
      dedupWindowMs: 0,
    });
    return { log, captured };
  }

  it('summarizeString does not preview nsec bytes (F-001)', () => {
    const { log, captured } = captureLog();
    const nsec = 'nsec1' + 'a'.repeat(58);
    log.warn('keys.import', { secret: nsec });
    const dump = JSON.stringify(captured);
    expect(dump).not.toContain(nsec);
    // No prefix of the secret is allowed in the dump.
    expect(dump).not.toContain('nsec1aaaaaaaa');
    // Classification is preserved so the dev sees what kind of value was redacted.
    const params = captured[0].params!.secret as { _kind: string; preview?: string; len: number };
    expect(params._kind).toBe('nsec');
    expect(params.preview).toBeUndefined();
    expect(params.len).toBe(nsec.length);
  });

  it('summarizeString does not preview cashu_token bytes (F-001)', () => {
    const { log, captured } = captureLog();
    const token = 'cashuA' + 'B'.repeat(80);
    log.warn('cashu.receive', { token });
    const dump = JSON.stringify(captured);
    expect(dump).not.toContain(token);
    expect(dump).not.toContain('cashuABBBB');
    const p = captured[0].params!.token as { _kind: string; preview?: string };
    expect(p._kind).toBe('cashu_token');
    expect(p.preview).toBeUndefined();
  });

  it('summarizeString does not preview lightning_invoice bytes (F-001)', () => {
    const { log, captured } = captureLog();
    const invoice = 'lnbc' + '1'.repeat(120);
    log.warn('ln.melt', { invoice });
    const p = captured[0].params!.invoice as { _kind: string; preview?: string };
    expect(p._kind).toBe('lightning_invoice');
    expect(p.preview).toBeUndefined();
  });

  it('summarizeString does not preview pem_key bytes (F-001)', () => {
    const { log, captured } = captureLog();
    const pem = '-----BEGIN PRIVATE KEY-----\n' + 'A'.repeat(200);
    log.warn('keys.derive', { pem });
    const p = captured[0].params!.pem as { _kind: string; preview?: string };
    expect(p._kind).toBe('pem_key');
    expect(p.preview).toBeUndefined();
  });

  it('summarizeString classifies npub separately from nsec and keeps its preview (F-012)', () => {
    const { log, captured } = captureLog();
    const npub = 'npub1' + 'a'.repeat(58);
    log.warn('user.show', { who: npub });
    const p = captured[0].params!.who as { _kind: string; preview?: string };
    expect(p._kind).toBe('npub');
    // Public identifier — preview is fine.
    expect(typeof p.preview).toBe('string');
  });

  it('long generic strings retain their preview (non-secret kinds)', () => {
    const { log, captured } = captureLog();
    const url = 'https://example.com/' + 'x'.repeat(120);
    log.warn('http.fetch', { url });
    const p = captured[0].params!.url as { _kind: string; preview?: string };
    expect(p._kind).toBe('url');
    expect(typeof p.preview).toBe('string');
  });

  it('startSpan respects warnAtMs/errorAtMs opts so long-running ops do not log as ERROR (audit 34 F-005)', () => {
    const log = createLogger({ level: 'debug', async: false, transports: [], pretty: false });
    const baseNow = performance.now;
    let fakeNow = 0;
    (performance as { now: () => number }).now = () => fakeNow;
    try {
      // Default thresholds: 6s end → ERROR
      fakeNow = 0;
      const defaultSpan = log.startSpan('test.default');
      fakeNow = 6000;
      defaultSpan.end();
      const defaultEnd = log.getRecentLogs().find((e) => e.event === 'test.default.end');
      expect(defaultEnd?.level).toBe('error');

      // Raised thresholds: 6s end with errorAtMs:60_000 → debug
      log.clearRecentLogs();
      fakeNow = 0;
      const aiSpan = log.startSpan('ai.send', undefined, { warnAtMs: 15_000, errorAtMs: 60_000 });
      fakeNow = 6000;
      aiSpan.end();
      const aiEnd = log.getRecentLogs().find((e) => e.event === 'ai.send.end');
      expect(aiEnd?.level).toBe('debug');
      // _slow only when above warnAtMs
      expect(aiEnd?.params?._slow).toBeUndefined();
    } finally {
      (performance as { now: () => number }).now = baseNow;
    }
  });

  it('dedup never mutates an entry already pushed to the ring buffer (F-008)', () => {
    const log = createLogger({
      level: 'debug',
      async: false,
      transports: [],
      pretty: false,
      dedupWindowMs: 1000,
    });
    log.debug('evt');
    const firstSnapshot = JSON.parse(JSON.stringify(log.getRecentLogs()));
    log.debug('evt');
    log.debug('evt');
    log.debug('evt');
    // The originally-pushed entry must be byte-for-byte identical: dedup
    // increments are tracked on the core, not by mutating the prior entry.
    const after = log.getRecentLogs();
    expect(after[0]).toEqual(firstSnapshot[0]);
    // Suppression count is flushed when the window closes.
    log.debug('different.event');
    const final = log.getRecentLogs();
    const summary = final.find(
      (e) => e.event === 'evt' && (e.params?._suppressed as number | undefined) !== undefined
    );
    expect(summary).toBeDefined();
    expect(summary?.params?._suppressed).toBe(3);
  });
});
