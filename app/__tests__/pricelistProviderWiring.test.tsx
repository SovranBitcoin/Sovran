/**
 * The feed's `resume()` is only worth having if something calls it. This
 * renders the real provider over a stubbed feed and drives the two events that
 * are supposed to re-arm it, plus the unmount that has to stop it — the
 * provider is remounted on every profile switch, so a missed `stop()` is one
 * orphaned socket per switch.
 */
import { AppState, Text } from 'react-native';
import { render, act } from '@testing-library/react-native';

import * as pricelistFeedModule from '@/shared/lib/pricelistFeed';
import { createPricelistFeed } from '@/shared/lib/pricelistFeed';
import { PricelistProvider } from '@/shared/providers/PricelistProvider';

// `jest.mock` is hoisted above the imports above, so these still apply.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/shared/lib/pricelistFeed', () => {
  const stub = { start: jest.fn(), resume: jest.fn(), stop: jest.fn() };
  return { __feed: stub, createPricelistFeed: jest.fn(() => stub) };
});

const offlineState = { isOffline: false };
jest.mock('@/shared/providers/OfflineProvider', () => ({
  useOfflineStatus: () => offlineState,
}));

const feed = (pricelistFeedModule as unknown as { __feed: Record<string, jest.Mock> }).__feed;
const offline = offlineState;

type AppStateHandler = (state: string) => void;

function renderProvider() {
  const handlers: AppStateHandler[] = [];
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
    handlers.push(handler as AppStateHandler);
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  const view = render(
    <PricelistProvider>
      <Text>child</Text>
    </PricelistProvider>
  );
  return { view, handlers, spy };
}

beforeEach(() => {
  feed.start.mockClear();
  feed.resume.mockClear();
  feed.stop.mockClear();
  (createPricelistFeed as jest.Mock).mockClear();
  offline.isOffline = false;
});

afterEach(() => jest.restoreAllMocks());

describe('PricelistProvider wiring', () => {
  it('starts exactly one feed and stops it on unmount', () => {
    const { view } = renderProvider();
    expect(createPricelistFeed).toHaveBeenCalledTimes(1);
    expect(feed.start).toHaveBeenCalledTimes(1);
    expect(feed.stop).not.toHaveBeenCalled();

    view.unmount();
    expect(feed.stop).toHaveBeenCalledTimes(1);
  });

  it('re-arms the feed when the app returns to the foreground', () => {
    const { handlers } = renderProvider();
    expect(handlers).toHaveLength(1);

    act(() => handlers[0]('background'));
    expect(feed.resume).not.toHaveBeenCalled();

    act(() => handlers[0]('active'));
    expect(feed.resume).toHaveBeenCalledWith('foreground');
  });

  it('re-arms on the offline→online edge, and not on the initial online', () => {
    const { view } = renderProvider();
    // Mount is already "online"; re-arming here would only re-enter the dial
    // the effect above just started.
    expect(feed.resume).not.toHaveBeenCalled();

    offline.isOffline = true;
    view.rerender(
      <PricelistProvider>
        <Text>child</Text>
      </PricelistProvider>
    );
    expect(feed.resume).not.toHaveBeenCalled();

    offline.isOffline = false;
    view.rerender(
      <PricelistProvider>
        <Text>child</Text>
      </PricelistProvider>
    );
    expect(feed.resume).toHaveBeenCalledWith('online');
  });
});
