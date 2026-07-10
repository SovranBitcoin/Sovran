/**
 * @jest-environment node
 */

import { act, renderHook } from '@testing-library/react-native';
import { ResultAsync } from 'neverthrow';

import { useNostrTierHealth } from '@/shared/hooks/useNostrTierHealth';
import { useNostrTierConfig, type NostrTierConfig } from '@/shared/lib/nostr/nostrTierConfig';
import { probeNaggHealth, probePrimalHealth } from '@/shared/lib/nostr/tierHealth';

let mockActiveFocusCleanup: (() => void) | undefined;

jest.mock('expo-router', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');

  return {
    useFocusEffect(effect: () => void | (() => void)) {
      ReactActual.useEffect(() => {
        const cleanup = effect();
        let cleaned = false;
        const blur = () => {
          if (cleaned) return;
          cleaned = true;
          cleanup?.();
          if (mockActiveFocusCleanup === blur) mockActiveFocusCleanup = undefined;
        };
        mockActiveFocusCleanup = blur;
        return blur;
      }, [effect]);
    },
  };
});

jest.mock('@/shared/lib/nostr/nostrTierConfig', () => ({
  useNostrTierConfig: jest.fn(),
}));

jest.mock('@/shared/lib/nostr/tierHealth', () => {
  const actual = jest.requireActual('@/shared/lib/nostr/tierHealth');
  return {
    ...actual,
    probeNaggHealth: jest.fn(),
    probePrimalHealth: jest.fn(),
  };
});

const mockedUseNostrTierConfig = jest.mocked(useNostrTierConfig);
const mockedProbeNaggHealth = jest.mocked(probeNaggHealth);
const mockedProbePrimalHealth = jest.mocked(probePrimalHealth);

const ENABLED_CONFIG: NostrTierConfig = {
  nagg: { appViewBaseUrl: 'https://nagg.example', enabled: true },
  primal: { enabled: true, url: 'wss://primal.example' },
  relay: { enabled: true, relays: ['wss://relay.example'] },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });

  return { promise, reject, resolve };
}

function probeResult(promise: Promise<boolean>) {
  return ResultAsync.fromSafePromise(promise);
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useNostrTierHealth', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockActiveFocusCleanup = undefined;
    mockedUseNostrTierConfig.mockReturnValue(ENABLED_CONFIG);
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    mockActiveFocusCleanup?.();
    mockActiveFocusCleanup = undefined;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('aborts run 1 and prevents its late result from overwriting run 2', async () => {
    const naggRun1 = deferred<boolean>();
    const naggRun2 = deferred<boolean>();
    const primalRun1 = deferred<boolean>();
    const primalRun2 = deferred<boolean>();
    mockedProbeNaggHealth
      .mockReturnValueOnce(probeResult(naggRun1.promise))
      .mockReturnValueOnce(probeResult(naggRun2.promise));
    mockedProbePrimalHealth
      .mockReturnValueOnce(probeResult(primalRun1.promise))
      .mockReturnValueOnce(probeResult(primalRun2.promise));

    const { result, unmount } = renderHook(() =>
      useNostrTierHealth({ 'wss://relay.example': 'connected' })
    );
    expect(mockedProbeNaggHealth).toHaveBeenCalledTimes(1);
    expect(mockedProbePrimalHealth).toHaveBeenCalledTimes(1);
    const run1NaggSignal = mockedProbeNaggHealth.mock.calls[0]?.[1]?.signal;
    const run1PrimalSignal = mockedProbePrimalHealth.mock.calls[0]?.[1]?.signal;
    expect(run1NaggSignal?.aborted).toBe(false);
    expect(run1PrimalSignal?.aborted).toBe(false);

    act(() => result.current.refresh());
    expect(mockedProbeNaggHealth).toHaveBeenCalledTimes(2);
    expect(mockedProbePrimalHealth).toHaveBeenCalledTimes(2);
    expect(run1NaggSignal?.aborted).toBe(true);
    expect(run1PrimalSignal?.aborted).toBe(true);
    expect(mockedProbeNaggHealth.mock.calls[1]?.[1]?.signal?.aborted).toBe(false);

    naggRun2.resolve(true);
    primalRun2.resolve(false);
    await flushEffects();
    expect(result.current).toMatchObject({
      isRefreshing: false,
      nagg: 'online',
      primal: 'offline',
      relay: 'online',
    });

    naggRun1.resolve(false);
    primalRun1.resolve(true);
    await flushEffects();
    expect(result.current).toMatchObject({
      isRefreshing: false,
      nagg: 'online',
      primal: 'offline',
    });

    unmount();
  });

  it('suppresses in-flight writes after focus is blurred', async () => {
    const nagg = deferred<boolean>();
    const primal = deferred<boolean>();
    mockedProbeNaggHealth.mockReturnValue(probeResult(nagg.promise));
    mockedProbePrimalHealth.mockReturnValue(probeResult(primal.promise));

    const { result, unmount } = renderHook(() => useNostrTierHealth({}));
    const naggSignal = mockedProbeNaggHealth.mock.calls[0]?.[1]?.signal;
    const primalSignal = mockedProbePrimalHealth.mock.calls[0]?.[1]?.signal;
    expect(result.current).toMatchObject({
      isRefreshing: true,
      nagg: 'checking',
      primal: 'checking',
    });

    act(() => mockActiveFocusCleanup?.());
    expect(naggSignal?.aborted).toBe(true);
    expect(primalSignal?.aborted).toBe(true);

    nagg.resolve(true);
    primal.resolve(true);
    await flushEffects();
    expect(result.current).toMatchObject({
      isRefreshing: true,
      nagg: 'checking',
      primal: 'checking',
    });

    unmount();
  });

  it('suppresses in-flight writes after unmount', async () => {
    const nagg = deferred<boolean>();
    const primal = deferred<boolean>();
    mockedProbeNaggHealth.mockReturnValue(probeResult(nagg.promise));
    mockedProbePrimalHealth.mockReturnValue(probeResult(primal.promise));

    const { result, unmount } = renderHook(() => useNostrTierHealth({}));
    const naggSignal = mockedProbeNaggHealth.mock.calls[0]?.[1]?.signal;
    unmount();
    expect(naggSignal?.aborted).toBe(true);

    nagg.resolve(true);
    primal.resolve(true);
    await flushEffects();
    expect(result.current).toMatchObject({
      isRefreshing: true,
      nagg: 'checking',
      primal: 'checking',
    });
  });

  it('keeps an already-online tier online while a manual refresh is running', async () => {
    mockedProbeNaggHealth.mockReturnValueOnce(probeResult(Promise.resolve(true)));
    mockedProbePrimalHealth.mockReturnValueOnce(probeResult(Promise.resolve(true)));

    const { result, unmount } = renderHook(() => useNostrTierHealth({}));
    await flushEffects();
    expect(result.current).toMatchObject({
      isRefreshing: false,
      nagg: 'online',
      primal: 'online',
    });

    const naggRefresh = deferred<boolean>();
    const primalRefresh = deferred<boolean>();
    mockedProbeNaggHealth.mockReturnValueOnce(probeResult(naggRefresh.promise));
    mockedProbePrimalHealth.mockReturnValueOnce(probeResult(primalRefresh.promise));

    act(() => result.current.refresh());
    expect(result.current).toMatchObject({
      isRefreshing: true,
      nagg: 'online',
      primal: 'online',
    });

    naggRefresh.resolve(true);
    primalRefresh.resolve(true);
    await flushEffects();
    expect(result.current.isRefreshing).toBe(false);

    unmount();
  });

  it('never invokes a probe for disabled tiers', async () => {
    mockedUseNostrTierConfig.mockReturnValue({
      nagg: { ...ENABLED_CONFIG.nagg, enabled: false },
      primal: { ...ENABLED_CONFIG.primal, enabled: false },
      relay: { ...ENABLED_CONFIG.relay, enabled: false },
    });

    const { result, unmount } = renderHook(() =>
      useNostrTierHealth({ 'wss://relay.example': 'connected' })
    );
    await flushEffects();

    expect(mockedProbeNaggHealth).not.toHaveBeenCalled();
    expect(mockedProbePrimalHealth).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({
      isRefreshing: false,
      nagg: 'disabled',
      primal: 'disabled',
      relay: 'disabled',
    });

    act(() => result.current.refresh());
    await flushEffects();
    expect(mockedProbeNaggHealth).not.toHaveBeenCalled();
    expect(mockedProbePrimalHealth).not.toHaveBeenCalled();

    unmount();
  });
});
