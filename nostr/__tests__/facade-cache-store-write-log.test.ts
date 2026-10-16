import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNormalizingStore } from '../src/facade/cache/store';
import { isNostrLogActive, nostrLog, setNostrLogger, type NostrLogger } from '../src/log';

type Row = { a?: string; b?: string };

function installSink() {
  const sink: NostrLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
  setNostrLogger(sink);
  return sink;
}

afterEach(() => {
  setNostrLogger(null);
  vi.restoreAllMocks();
});

describe('NormalizingStore write logging', () => {
  it('logs one event per batch with written, changed and notified counts', () => {
    const store = createNormalizingStore<Row>({ maxEntries: 10, name: 'profiles' });
    store.set('k1', { a: 'one' });
    store.subscribe(() => {});
    store.subscribe(() => {});
    store.subscribeKey('k1', () => {});
    store.subscribeKey('k2', () => {});
    store.subscribeKey('k2', () => {});
    const sink = installSink();

    store.setMany([
      ['k1', { a: 'one' }], // idempotent: written, not changed, nobody notified
      ['k2', { a: 'two' }],
      ['k3', { a: 'three' }], // changed, but no key listener
    ]);

    expect(sink.debug).toHaveBeenCalledTimes(1);
    expect(sink.debug).toHaveBeenCalledWith('cache.store.write', {
      store: 'profiles',
      written: 3,
      changed: 2,
      keyListenersNotified: 2,
      globalListenersNotified: 2,
    });
  });

  it('still reports a batch that changed nothing, with no listeners notified', () => {
    const store = createNormalizingStore<Row>({ maxEntries: 10, name: 'notes' });
    store.set('k1', { a: 'one' });
    const listener = vi.fn();
    store.subscribe(listener);
    store.subscribeKey('k1', listener);
    const sink = installSink();

    store.setMany([['k1', { a: 'one' }]]);

    expect(listener).not.toHaveBeenCalled();
    expect(sink.debug).toHaveBeenCalledWith('cache.store.write', {
      store: 'notes',
      written: 1,
      changed: 0,
      keyListenersNotified: 0,
      globalListenersNotified: 0,
    });
  });

  it('logs a single set as a batch of one', () => {
    const store = createNormalizingStore<Row>({ maxEntries: 10 });
    store.subscribeKey('k1', () => {});
    const sink = installSink();

    store.set('k1', { a: 'one' });

    expect(sink.debug).toHaveBeenCalledTimes(1);
    expect(sink.debug).toHaveBeenCalledWith('cache.store.write', {
      store: 'unnamed',
      written: 1,
      changed: 1,
      keyListenersNotified: 1,
      globalListenersNotified: 0,
    });
  });

  it('never reaches the log seam while no sink is installed', () => {
    const removed = installSink();
    setNostrLogger(null);
    const debug = vi.spyOn(nostrLog, 'debug');
    const store = createNormalizingStore<Row>({ maxEntries: 10, name: 'profiles' });
    const listener = vi.fn();
    store.subscribe(listener);

    store.set('k1', { a: 'one' });
    store.setMany([['k2', { b: 'two' }]]);

    expect(isNostrLogActive()).toBe(false);
    expect(debug).not.toHaveBeenCalled();
    expect(removed.debug).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.get('k2')).toEqual({ b: 'two' });
  });
});
