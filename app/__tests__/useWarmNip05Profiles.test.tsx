/** @jest-environment node */
import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { verifyNip05 } from 'wallet';
import { useWarmNip05Profiles } from '@/shared/hooks/useWarmNip05Profiles';
import { useNip05Verification } from '@/shared/hooks/useNip05Verification';

jest.mock('wallet', () => ({ ...jest.requireActual('wallet'), verifyNip05: jest.fn() }));
let mockMode = false;
let currentState: AppStateStatus = 'active';
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (select: (state: { mockMode: boolean }) => unknown) => select({ mockMode }),
}));
let listeners: Set<(state: AppStateStatus) => void>;
beforeEach(() => {
  jest.useFakeTimers();
  mockMode = false;
  listeners = new Set();
  currentState = 'active';
  jest.spyOn(AppState, 'currentState', 'get').mockImplementation(() => currentState);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.add(listener);
    return {
      remove: () => {
        listeners.delete(listener);
      },
    };
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.resetAllMocks();
  jest.restoreAllMocks();
});
const key = 'a'.repeat(64);
function foreground(state: AppStateStatus) {
  currentState = state;
  for (const listener of listeners) listener(state);
}
it('warms profiles that arrived while suspended as soon as the app resumes', async () => {
  currentState = 'background';
  jest
    .mocked(verifyNip05)
    .mockResolvedValue({ status: 'verified', identifier: 'alice@resume.example' });
  const profiles = new Map([[key, { nip05: 'alice@resume.example' }]]);
  const warm = renderHook(() => useWarmNip05Profiles(profiles));
  expect(verifyNip05).not.toHaveBeenCalled();
  await act(async () => foreground('active'));
  const payment = renderHook(() => useNip05Verification('alice@resume.example', key));
  expect(payment.result.current.state.status).toBe('verified');
  expect(verifyNip05).toHaveBeenCalledTimes(1);
  payment.unmount();
  warm.unmount();
});

it('reuses warm checks across payment mounts and renews before expiry without a pending flash', async () => {
  const address = 'alice@renew.example';
  jest.mocked(verifyNip05).mockResolvedValue({ status: 'verified', identifier: address });
  const profiles = new Map([[key, { nip05: address }]]);
  const warm = renderHook(() => useWarmNip05Profiles(profiles));
  await act(async () => {});
  const first = renderHook(() => useNip05Verification(address, key));
  expect(first.result.current.state.status).toBe('verified');
  first.unmount();
  const next = renderHook(() => useNip05Verification(address, key));
  expect(next.result.current.state.status).toBe('verified');
  expect(verifyNip05).toHaveBeenCalledTimes(1);
  let finish!: (value: Awaited<ReturnType<typeof verifyNip05>>) => void;
  jest.mocked(verifyNip05).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await act(async () => {
    await jest.advanceTimersByTimeAsync(870_000);
  });
  expect(verifyNip05).toHaveBeenCalledTimes(2);
  expect(next.result.current.state.status).toBe('verified');
  await act(async () => {
    await jest.advanceTimersByTimeAsync(30_000);
  });
  expect(next.result.current.state.status).toBe('pending'); // never extend expired trust
  await act(async () => finish({ status: 'mismatch', identifier: address }));
  expect(next.result.current.state.status).toBe('mismatch');
  next.unmount();
  warm.unmount();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
  expect(jest.getTimerCount()).toBe(0);
});

it('does no background or mock-mode warming and cleans up on unmount', async () => {
  const address = 'alice@paused.example';
  jest.mocked(verifyNip05).mockResolvedValue({ status: 'verified', identifier: address });
  const profiles = new Map([[key, { nip05: address }]]);
  mockMode = true;
  const demo = renderHook(() => useWarmNip05Profiles(profiles));
  expect(verifyNip05).not.toHaveBeenCalled();
  demo.unmount();
  mockMode = false;
  const live = renderHook(() => useWarmNip05Profiles(profiles));
  await act(async () => {});
  act(() => foreground('background'));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(960_000);
  });
  expect(verifyNip05).toHaveBeenCalledTimes(1);
  live.unmount();
  act(() => foreground('active'));
  expect(verifyNip05).toHaveBeenCalledTimes(1);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
  expect(jest.getTimerCount()).toBe(0);
});

it('allows network latency between the poll and the original verification deadline', async () => {
  const address = 'alice@latency.example';
  jest
    .mocked(verifyNip05)
    .mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { status: 'verified', identifier: address };
    })
    .mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { status: 'verified', identifier: address };
    });
  const profiles = new Map([[key, { nip05: address }]]);
  const warm = renderHook(() => useWarmNip05Profiles(profiles));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(100);
  });
  const payment = renderHook(() => useNip05Verification(address, key));
  expect(payment.result.current.state.status).toBe('verified');
  await act(async () => {
    await jest.advanceTimersByTimeAsync(899_950);
  });
  expect(verifyNip05).toHaveBeenCalledTimes(2);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(100);
  });
  expect(payment.result.current.state.status).toBe('verified');
  await act(async () => {
    await jest.advanceTimersByTimeAsync(100);
  });
  payment.unmount();
  warm.unmount();
});
