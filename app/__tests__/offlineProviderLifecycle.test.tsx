import { AppState } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import * as Network from 'expo-network';

import React, { useEffect } from 'react';
import { recheckConnectivity, startConnectivity, useOfflineStatus } from '@/runtime/connectivity';

/** Runs the connectivity engine while mounted, as the app root does. */
function OfflineStatusProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => startConnectivity(), []);
  return <>{children}</>;
}
import { resolveOfflineReachability } from '@/shared/lib/offlineReachability';
import { log } from '@/shared/lib/logger';

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

it('checks a healthy idle connection once per 5 minutes and still reacts to network changes', async () => {
  const view = renderHook(useOfflineStatus, { wrapper: OfflineStatusProvider });
  await flush();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(299_000);
  });
  // A minute-long poll made 5 checks (up to 25 HTTPS probes) here.
  expect(Network.getNetworkStateAsync).toHaveBeenCalledTimes(1);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1_000);
  });
  expect(Network.getNetworkStateAsync).toHaveBeenCalledTimes(2);
  view.unmount();
});

it('reacts to an OS network change at once, and confirms offline within seconds', async () => {
  const { result } = renderHook(useOfflineStatus, { wrapper: OfflineStatusProvider });
  await flush();
  expect(Network.getNetworkStateAsync).toHaveBeenCalledTimes(1);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1_000);
  });
  // Airplane mode: the OS reports the change; the probes then fail.
  jest.mocked(resolveOfflineReachability).mockResolvedValue({
    isOffline: true,
    reason: 'network-disconnected',
    probes: [],
  });
  act(() => jest.mocked(Network.addNetworkStateListener).mock.calls[0][0]({ isConnected: false }));
  await flush();
  expect(Network.getNetworkStateAsync).toHaveBeenCalledTimes(2);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(6_000);
  });
  expect(result.current).toEqual({ isOffline: true, isDisconnected: true });
});

it('checks at once when the send flow asks, without waiting for the poll', async () => {
  const { result } = renderHook(useOfflineStatus, { wrapper: OfflineStatusProvider });
  await flush();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(30_000);
  });
  // The uplink died without an OS event (captive portal).
  jest.mocked(resolveOfflineReachability).mockResolvedValue({
    isOffline: true,
    reason: 'probe-unreachable',
    probes: [],
  });
  act(() => recheckConnectivity());
  await flush();
  expect(Network.getNetworkStateAsync).toHaveBeenCalledTimes(2);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(6_000);
  });
  expect(result.current.isOffline).toBe(true);
});

it('retries an offline connection with a back-off that still tops out at a minute', async () => {
  jest.mocked(resolveOfflineReachability).mockResolvedValue({
    isOffline: true,
    reason: 'probe-unreachable',
    probes: [],
  });
  renderHook(useOfflineStatus, { wrapper: OfflineStatusProvider });
  await flush();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10 * 60_000);
  });
  const before = jest.mocked(Network.getNetworkStateAsync).mock.calls.length;
  await act(async () => {
    await jest.advanceTimersByTimeAsync(60_000);
  });
  expect(jest.mocked(Network.getNetworkStateAsync).mock.calls.length - before).toBe(1);
});

it('still reacts to network changes while idle', async () => {
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

it('logs each change with the reason and the target that decided it', async () => {
  jest.mocked(resolveOfflineReachability).mockResolvedValue({
    isOffline: true,
    reason: 'probe-unreachable',
    probes: [
      { name: 'nagg', host: 'nagg.example', ok: false, status: 404, durationMs: 40 },
      { name: 'second', host: 'second.example', ok: false, durationMs: 1500, error: 'timeout' },
    ],
  });
  renderHook(useOfflineStatus, { wrapper: OfflineStatusProvider });
  await flush();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(6000);
  });
  expect(log.info).toHaveBeenCalledWith('provider.offline.transition', {
    from: 'online',
    to: 'offline',
    reachabilityReason: 'probe-unreachable',
    probeStatus: 'failed',
    probeHost: 'second.example',
    probeName: 'second',
    probeStatusCode: undefined,
    probeError: 'timeout',
    probeCount: 2,
    probeDurationMs: 1500,
    answeredBy: undefined,
    probeOutcomes: 'nagg:404,second:timeout',
  });

  jest.mocked(resolveOfflineReachability).mockResolvedValue({
    isOffline: false,
    reason: 'probe-reachable',
    probes: [
      { name: 'nagg', host: 'nagg.example', ok: false, status: 404, durationMs: 40 },
      { name: 'second', host: 'second.example', ok: true, status: 200, durationMs: 120 },
    ],
    answeredBy: 'second',
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(3000);
  });
  expect(log.info).toHaveBeenLastCalledWith('provider.offline.transition', {
    from: 'offline',
    to: 'online',
    reachabilityReason: 'probe-reachable',
    probeStatus: 'success',
    probeHost: 'second.example',
    probeName: 'second',
    probeStatusCode: 200,
    probeError: undefined,
    probeCount: 2,
    probeDurationMs: 120,
    answeredBy: 'second',
    probeOutcomes: 'nagg:404,second:200',
  });
});

it('says the phone is disconnected only when the OS reports no network, not when probes fail', async () => {
  jest.mocked(resolveOfflineReachability).mockResolvedValue({
    isOffline: true,
    reason: 'probe-unreachable',
    probes: [],
  });
  const { result } = renderHook(useOfflineStatus, { wrapper: OfflineStatusProvider });
  await flush();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(6000);
  });
  expect(result.current.isOffline).toBe(true);
  expect(result.current.isDisconnected).toBe(false);

  jest.mocked(resolveOfflineReachability).mockResolvedValue({
    isOffline: true,
    reason: 'network-disconnected',
    probes: [],
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(6000);
  });
  expect(result.current.isOffline).toBe(true);
  expect(result.current.isDisconnected).toBe(true);

  jest.mocked(resolveOfflineReachability).mockResolvedValue({ ...reachable, probes: [] });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(6000);
  });
  expect(result.current.isOffline).toBe(false);
  expect(result.current.isDisconnected).toBe(false);
});
