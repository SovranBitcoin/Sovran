/**
 * The feed's `resume()` and `setOffline()` are only worth having if something
 * calls them. This starts the real account price feed over a stubbed feed and
 * drives the foreground and connectivity events, plus the stop that has to
 * stop it — the runtime starts it again on every profile switch, so a missed
 * `stop()` is one orphaned socket per switch.
 */
import { AppState } from 'react-native';

import * as pricelistFeedModule from '@/shared/lib/pricelistFeed';
import { createPricelistFeed } from '@/shared/lib/pricelistFeed';
import { appRuntime, startPricelistFeed } from '@/runtime/AppRuntime';

// `jest.mock` is hoisted above the imports above, so these still apply.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/shared/lib/pricelistFeed', () => {
  const stub = { start: jest.fn(), resume: jest.fn(), stop: jest.fn(), setOffline: jest.fn() };
  return { __feed: stub, createPricelistFeed: jest.fn(() => stub) };
});

const offlineState = { isOffline: false, isDisconnected: false };
const mockOfflineListeners = new Set<() => void>();
jest.mock('@/runtime/connectivity', () => ({
  getOfflineStatus: () => offlineState,
  subscribeOfflineStatus: (listener: () => void) => {
    mockOfflineListeners.add(listener);
    return () => mockOfflineListeners.delete(listener);
  },
  startConnectivity: () => () => undefined,
}));

const feed = (pricelistFeedModule as unknown as { __feed: Record<string, jest.Mock> }).__feed;
const offline = offlineState;

type AppStateHandler = (state: string) => void;

function startFeed() {
  const handlers: AppStateHandler[] = [];
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
    handlers.push(handler as AppStateHandler);
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  const stop = startPricelistFeed();
  return { stop, handlers, spy };
}

function setConnectivity(next: typeof offlineState) {
  Object.assign(offline, next);
  mockOfflineListeners.forEach((listener) => listener());
}

beforeEach(() => {
  feed.start.mockClear();
  feed.resume.mockClear();
  feed.stop.mockClear();
  feed.setOffline.mockClear();
  (createPricelistFeed as jest.Mock).mockClear();
  mockOfflineListeners.clear();
  offline.isOffline = false;
  offline.isDisconnected = false;
});

afterEach(() => jest.restoreAllMocks());

describe('account price feed wiring', () => {
  it('starts exactly one feed and stops it on stop', () => {
    const { stop } = startFeed();
    expect(createPricelistFeed).toHaveBeenCalledTimes(1);
    expect(feed.start).toHaveBeenCalledTimes(1);
    expect(feed.stop).not.toHaveBeenCalled();

    stop();
    expect(feed.stop).toHaveBeenCalledTimes(1);
    // Nothing keeps listening to connectivity after the account stops.
    expect(mockOfflineListeners.size).toBe(0);
  });

  it('re-arms the feed when the app returns to the foreground', () => {
    const { handlers } = startFeed();
    expect(handlers).toHaveLength(1);

    handlers[0]('background');
    expect(feed.resume).not.toHaveBeenCalled();

    handlers[0]('active');
    expect(feed.resume).toHaveBeenCalledWith('foreground');
  });

  it('tells the feed its connectivity before it starts, then on every change', () => {
    startFeed();
    expect(feed.setOffline.mock.calls).toEqual([[false]]);
    expect(feed.setOffline.mock.invocationCallOrder[0]).toBeLessThan(
      feed.start.mock.invocationCallOrder[0]
    );

    setConnectivity({ isOffline: true, isDisconnected: true });
    expect(feed.setOffline).toHaveBeenLastCalledWith(true);

    setConnectivity({ isOffline: false, isDisconnected: false });
    expect(feed.setOffline).toHaveBeenLastCalledWith(false);
    // Reconnect goes through the pause, not a second resume path.
    expect(feed.resume).not.toHaveBeenCalled();
  });

  it('keeps polling when only reachability probes fail, so Mempool can still answer', () => {
    // Coinbase's /v2/time can be the only probe: Coinbase down must not stop
    // the feed from falling back to Mempool.space.
    offline.isOffline = true;
    offline.isDisconnected = false;
    startFeed();
    expect(feed.setOffline.mock.calls).toEqual([[false]]);
  });

  it('starts a feed paused when the phone is offline at start', () => {
    offline.isOffline = true;
    offline.isDisconnected = true;
    startFeed();
    expect(feed.setOffline.mock.calls[0]).toEqual([true]);
    expect(feed.setOffline.mock.invocationCallOrder[0]).toBeLessThan(
      feed.start.mock.invocationCallOrder[0]
    );
  });

  it('runs one feed per account scope and stops it before the next account starts', () => {
    startFeed();
    feed.start.mockClear();
    (createPricelistFeed as jest.Mock).mockClear();

    appRuntime.start(0);
    expect(appRuntime.getSnapshot()).toEqual({ accountIndex: 0, nostrClient: undefined });
    expect(feed.start).toHaveBeenCalledTimes(1);

    feed.stop.mockClear();
    appRuntime.stop();
    expect(feed.stop).toHaveBeenCalledTimes(1);
    expect(appRuntime.getSnapshot()).toEqual({ accountIndex: null, nostrClient: undefined });

    appRuntime.start(1);
    expect(createPricelistFeed).toHaveBeenCalledTimes(2);
    expect(appRuntime.getSnapshot().accountIndex).toBe(1);
    appRuntime.stop();
  });
});
