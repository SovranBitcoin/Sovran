/**
 * @jest-environment node
 */

import { act, renderHook } from '@testing-library/react-native';
import { ResultAsync } from 'neverthrow';

import { useNostrTierHealth } from '@/shared/hooks/useNostrTierHealth';
import { useNostrTierConfig, type NostrTierConfig } from '@/shared/lib/nostr/nostrTierConfig';
import { probePrimalHealth } from '@/shared/lib/nostr/tierHealth';

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
jest.mock('@/shared/hooks/useForegroundFocusEffect', () => ({
  useForegroundFocusEffect: (effect: () => void | (() => void)) =>
    jest
      .requireMock<{ useFocusEffect: (effect: () => void | (() => void)) => void }>('expo-router')
      .useFocusEffect(effect),
}));

jest.mock('@/shared/lib/nostr/nostrTierConfig', () => ({
  useNostrTierConfig: jest.fn(),
}));

jest.mock('@/shared/lib/nostr/tierHealth', () => {
  const actual = jest.requireActual('@/shared/lib/nostr/tierHealth');
  return {
    ...actual,
    probePrimalHealth: jest.fn(),
  };
});

const mockedUseNostrTierConfig = jest.mocked(useNostrTierConfig);
const mockedProbePrimalHealth = jest.mocked(probePrimalHealth);

const ENABLED_CONFIG: NostrTierConfig = {
  primal: { enabled: true, urls: ['wss://primal.example'] },
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
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('probes Primal on focus, polls every 30s, and aborts on blur', async () => {
    const first = deferred<boolean>();
    mockedProbePrimalHealth.mockReturnValueOnce(probeResult(first.promise));

    const { result, unmount } = renderHook(() =>
      useNostrTierHealth({ 'wss://relay.example': 'connected' })
    );
    expect(result.current.primal).toBe('checking');
    expect(result.current.relay).toBe('online');

    first.resolve(true);
    await flushEffects();
    expect(result.current.primal).toBe('online');
    expect(result.current.primalHosts['wss://primal.example']).toBe('online');

    const second = deferred<boolean>();
    mockedProbePrimalHealth.mockReturnValueOnce(probeResult(second.promise));
    act(() => jest.advanceTimersByTime(30_000));
    expect(mockedProbePrimalHealth).toHaveBeenCalledTimes(2);

    act(() => mockActiveFocusCleanup?.());
    second.resolve(false);
    await flushEffects();
    expect(result.current.primal).toBe('online');

    unmount();
  });

  it('shows pull-to-refresh spinner and clears it when probe completes', async () => {
    mockedProbePrimalHealth.mockReturnValueOnce(probeResult(Promise.resolve(true)));
    const { result, unmount } = renderHook(() =>
      useNostrTierHealth({ 'wss://relay.example': 'connected' })
    );
    await flushEffects();
    expect(result.current.isRefreshing).toBe(false);

    const refresh = deferred<boolean>();
    mockedProbePrimalHealth.mockReturnValueOnce(probeResult(refresh.promise));
    act(() => result.current.refresh());
    expect(result.current.isRefreshing).toBe(true);

    refresh.resolve(true);
    await flushEffects();
    expect(result.current.isRefreshing).toBe(false);
    unmount();
  });

  it('never invokes a probe for disabled tiers', async () => {
    mockedUseNostrTierConfig.mockReturnValue({
      primal: { ...ENABLED_CONFIG.primal, enabled: false },
      relay: { ...ENABLED_CONFIG.relay, enabled: false },
    });

    const { result, unmount } = renderHook(() =>
      useNostrTierHealth({ 'wss://relay.example': 'connected' })
    );
    await flushEffects();

    expect(mockedProbePrimalHealth).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({
      isRefreshing: false,
      primal: 'disabled',
      relay: 'disabled',
    });

    act(() => result.current.refresh());
    await flushEffects();
    expect(mockedProbePrimalHealth).not.toHaveBeenCalled();
    unmount();
  });
});
