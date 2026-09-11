/** @jest-environment node */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { NDKCacheAdapterSqlite } from '@nostr-dev-kit/ndk-mobile';
import { NostrNDKProvider } from '@/shared/providers/NostrNDKProvider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mockCanStart = false;
let mockKeys: { privateKey: string; pubkey: string } | null = null;
const mockInitialize = jest.fn();
jest.mock(
  '@nostr-dev-kit/ndk-mobile',
  () => ({
    NDKCacheAdapterSqlite: jest.fn().mockImplementation((dbName: string) => ({ dbName })),
    NDKPrivateKeySigner: jest.fn(),
    useNDK: () => ({ init: mockInitialize }),
  }),
  { virtual: true }
);
jest.mock('@/shared/ndk', () => ({ relays: [] }));
jest.mock('@/shared/lib/nostr/giftWrapCache', () => ({
  giftWrapCache: { cache: { hydrate: jest.fn() } },
}));
jest.mock('@/shared/lib/nostr/outbox/useOwnRelayListSync', () => ({
  useOwnRelayListSync: jest.fn(),
}));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: mockKeys }),
}));
jest.mock('@/shared/providers/InitializationProvider', () => ({
  useInitializationStage: () => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.useMemo(
      () => ({ canStart: mockCanStart, log: jest.fn(), complete: jest.fn(), error: jest.fn() }),
      [mockCanStart]
    );
  },
}));
jest.mock('@/shared/lib/logger', () => ({
  useInitMount: jest.fn(),
  initLog: jest.fn(),
  initPhaseSync: (_name: string, run: () => void) => run(),
  nostrLog: { debug: jest.fn(), info: jest.fn(), error: jest.fn() },
}));
let renderer: TestRenderer.ReactTestRenderer;
function tree(accountIndex = 0) {
  return (
    <React.StrictMode>
      <NostrNDKProvider key={accountIndex} accountIndex={accountIndex}>
        {null}
      </NostrNDKProvider>
    </React.StrictMode>
  );
}
beforeEach(() => {
  jest.useFakeTimers();
  mockCanStart = false;
  mockKeys = null;
  jest.clearAllMocks();
});
afterEach(() => {
  act(() => renderer.unmount());
  jest.useRealTimers();
});

it('does not open the SQLite cache while stage dependencies or keys are missing', () => {
  act(() => {
    renderer = TestRenderer.create(tree());
  });
  expect(NDKCacheAdapterSqlite).not.toHaveBeenCalled();
  mockCanStart = true;
  act(() => renderer.update(tree()));
  act(() => jest.advanceTimersByTime(1000));
  expect(NDKCacheAdapterSqlite).not.toHaveBeenCalled();
  expect(mockInitialize).not.toHaveBeenCalled();
});

it('opens one cache under mount replay and preserves the full NDK warmup delay', () => {
  mockCanStart = true;
  mockKeys = { privateKey: 'fixture-private-key', pubkey: 'fixture-public-key' };
  act(() => {
    renderer = TestRenderer.create(tree());
  });
  expect(NDKCacheAdapterSqlite).toHaveBeenCalledTimes(1);
  expect(NDKCacheAdapterSqlite).toHaveBeenCalledWith('nostr');
  act(() => jest.advanceTimersByTime(799));
  expect(mockInitialize).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(1));
  expect(mockInitialize).toHaveBeenCalledTimes(1);
});

it('cancels outgoing profile initialization and initializes the account-scoped cache only', () => {
  mockCanStart = true;
  mockKeys = { privateKey: 'fixture-private-key', pubkey: 'fixture-public-key' };
  act(() => {
    renderer = TestRenderer.create(tree());
  });
  act(() => jest.advanceTimersByTime(400));
  act(() => renderer.update(tree(2)));
  act(() => jest.advanceTimersByTime(400));
  expect(mockInitialize).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(400));
  expect(mockInitialize).toHaveBeenCalledTimes(1);
  expect(mockInitialize.mock.calls[0][0].cacheAdapter.dbName).toBe('nostr-2');
});

it('cancels deferred initialization after keys become unavailable', () => {
  mockCanStart = true;
  mockKeys = { privateKey: 'fixture-private-key', pubkey: 'fixture-public-key' };
  act(() => {
    renderer = TestRenderer.create(tree());
  });
  act(() => jest.advanceTimersByTime(400));
  mockKeys = null;
  act(() => renderer.update(tree()));
  act(() => jest.advanceTimersByTime(800));
  expect(mockInitialize).not.toHaveBeenCalled();
});
