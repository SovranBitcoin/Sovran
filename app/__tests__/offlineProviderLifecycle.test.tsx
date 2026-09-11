import { AppState } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import * as Network from 'expo-network';

import { OfflineStatusProvider, useOfflineStatus } from '@/shared/providers/OfflineProvider';
import { resolveOfflineReachability } from '@/shared/lib/offlineReachability';

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn().mockResolvedValue({ isConnected: true }),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('@/shared/lib/offlineReachability', () => ({ resolveOfflineReachability: jest.fn() }));
jest.mock('@/shared/lib/logger', () => ({
  initLog: jest.fn(),
  useInitMount: jest.fn(),
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (select: (state: { mockOffline: boolean }) => unknown) =>
    select({ mockOffline: false }),
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: jest.fn() }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('react-native-safe-area-context', () => ({}));

const reachable = { isOffline: false, reason: 'probe-reachable', probes: [] } as const;
const initialAppState = Object.getOwnPropertyDescriptor(AppState, 'currentState');
let appStateHandler: Parameters<typeof AppState.addEventListener>[1];

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    writable: true,
    value: 'active',
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    appStateHandler = listener;
    return { remove: jest.fn() };
  });
  jest.mocked(resolveOfflineReachability).mockResolvedValue({ ...reachable, probes: [] });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  if (initialAppState) Object.defineProperty(AppState, 'currentState', initialAppState);
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

it('checks a healthy idle connection once per minute and still reacts to network changes', async () => {
  renderHook(useOfflineStatus, { wrapper: OfflineStatusProvider });
  await flush();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(59_000);
  });
  expect(Network.getNetworkStateAsync).toHaveBeenCalledTimes(1);
  act(() => jest.mocked(Network.addNetworkStateListener).mock.calls[0][0]({ isConnected: false }));
  await flush();
  expect(Network.getNetworkStateAsync).toHaveBeenCalledTimes(2);
});

it('stops connectivity polling in background and refreshes immediately on return', async () => {
  const { unmount } = renderHook(useOfflineStatus, { wrapper: OfflineStatusProvider });
  await flush();
  expect(Network.getNetworkStateAsync).toHaveBeenCalledTimes(1);

  act(() => appStateHandler('background'));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(60_000);
  });
  expect(Network.getNetworkStateAsync).toHaveBeenCalledTimes(1);

  act(() => appStateHandler('active'));
  await flush();
  expect(Network.getNetworkStateAsync).toHaveBeenCalledTimes(2);
  unmount();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(60_000);
  });
  expect(Network.getNetworkStateAsync).toHaveBeenCalledTimes(2);
});

it('does not start probes when mounted in background', async () => {
  AppState.currentState = 'background';
  renderHook(useOfflineStatus, { wrapper: OfflineStatusProvider });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(60_000);
  });
  expect(Network.getNetworkStateAsync).not.toHaveBeenCalled();
  act(() => appStateHandler('active'));
  await flush();
  expect(Network.getNetworkStateAsync).toHaveBeenCalledTimes(1);
});

it('discards an old probe and schedules a fresh one after a fast background/foreground cycle', async () => {
  let resolveProbe!: (value: Awaited<ReturnType<typeof resolveOfflineReachability>>) => void;
  jest.mocked(resolveOfflineReachability).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveProbe = resolve;
      })
  );
  const { result } = renderHook(useOfflineStatus, { wrapper: OfflineStatusProvider });
  await flush();
  act(() => appStateHandler('background'));
  act(() => appStateHandler('active'));
  await flush();
  expect(Network.getNetworkStateAsync).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolveProbe({ isOffline: true, reason: 'probe-unreachable', probes: [] });
  });
  expect(Network.getNetworkStateAsync).toHaveBeenCalledTimes(2);
  expect(result.current.isOffline).toBe(false);
});

it('still requires consecutive foreground failures before reporting offline', async () => {
  jest.mocked(resolveOfflineReachability).mockResolvedValue({
    isOffline: true,
    reason: 'probe-unreachable',
    probes: [],
  });
  const { result } = renderHook(useOfflineStatus, { wrapper: OfflineStatusProvider });
  await flush();
  expect(result.current.isOffline).toBe(false);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(6000);
  });
  expect(result.current.isOffline).toBe(true);
  jest.mocked(resolveOfflineReachability).mockResolvedValue({ ...reachable, probes: [] });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(3000);
  });
  expect(result.current.isOffline).toBe(false);
});
