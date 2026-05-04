import { createLogger } from '@/shared/lib/logger';

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
