/**
 * The two bounded waits an account change makes besides `settleWithin`:
 *
 *  - `switchStep` runs one in-process switch step and rejects if it has not
 *    settled within five seconds (a synchronous throw rejects too);
 *  - `cleanupCocoWithTimeout` waits up to five seconds for the wallet teardown,
 *    logs a timeout or a failure, and always resolves.
 *
 * Neither cancels the work: it may still finish after the deadline.
 */
import { switchStep } from '@/shared/lib/profile/inProcessProfileSwitch';
import { cleanupCocoWithTimeout } from '@/shared/lib/profile/profileTransition';

const mockCleanup = jest.fn<Promise<void>, []>();
const mockWarn = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));
jest.mock('@/shared/lib/logger', () => ({
  log: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: (...args: unknown[]) => mockWarn(...args),
    error: jest.fn(),
  },
  redactError: (error: unknown) => error,
}));
jest.mock('@/shared/lib/cashu/manager', () => ({ CocoManager: { cleanup: () => mockCleanup() } }));
jest.mock('@/shared/lib/profile/appRestart', () => ({ restartApp: jest.fn() }));
jest.mock('@/shared/stores/runtime/paymentStatusStore', () => ({ usePaymentStatusStore: {} }));
jest.mock('@/shared/stores/runtime/popupStore', () => ({ usePopupStore: {} }));
jest.mock('@/shared/stores/global/profileStore', () => ({
  PROFILE_STORE_PERSIST_VERSION: 0,
  useProfileStore: {},
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({}));
jest.mock('@/shared/lib/account/accountRegistry', () => ({}));

type Outcome = { value?: unknown; error?: unknown } | 'pending';
function track(promise: Promise<unknown>) {
  let outcome: Outcome = 'pending';
  promise.then(
    (value) => (outcome = { value }),
    (error) => (outcome = { error })
  );
  return () => outcome;
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  jest.useFakeTimers();
  mockCleanup.mockReset();
  mockWarn.mockReset();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('switchStep', () => {
  it('returns what the step returns, sync or async', async () => {
    await expect(switchStep(() => 7)).resolves.toBe(7);
    await expect(switchStep(async () => 'done')).resolves.toBe('done');
  });

  it('rejects with the step’s own error, thrown or rejected', async () => {
    await expect(
      switchStep(() => {
        throw new Error('sync boom');
      })
    ).rejects.toThrow('sync boom');
    await expect(switchStep(() => Promise.reject(new Error('async boom')))).rejects.toThrow(
      'async boom'
    );
  });

  it('settles with the step just before five seconds, and times out at five', async () => {
    let finish!: (v: string) => void;
    const early = track(switchStep(() => new Promise<string>((r) => (finish = r))));
    await flush();
    jest.advanceTimersByTime(4_999);
    finish('in time');
    await flush();
    expect(early()).toEqual({ value: 'in time' });

    const late = track(switchStep(() => new Promise<string>(() => {})));
    jest.advanceTimersByTime(4_999);
    await flush();
    expect(late()).toBe('pending');
    jest.advanceTimersByTime(1);
    await flush();
    expect(late()).toEqual({ error: new Error('Profile switch step timed out') });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a step that finishes after timing out does not change the rejection', async () => {
    let finish!: () => void;
    const outcome = track(switchStep(() => new Promise<void>((r) => (finish = r))));
    jest.advanceTimersByTime(5_000);
    await flush();
    finish();
    await flush();
    expect(outcome()).toEqual({ error: new Error('Profile switch step timed out') });
  });
});

describe('cleanupCocoWithTimeout', () => {
  it('resolves when the teardown finishes, logging nothing and leaving no timer', async () => {
    mockCleanup.mockResolvedValue(undefined);
    await cleanupCocoWithTimeout();
    expect(mockWarn).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('logs a failed teardown and resolves', async () => {
    const error = new Error('dispose failed');
    mockCleanup.mockRejectedValue(error);
    await cleanupCocoWithTimeout();
    expect(mockWarn.mock.calls).toEqual([['profile.orchestrator.cleanup_failed', { error }]]);
  });

  it('gives up at five seconds with a timeout warning, and ignores a late finish', async () => {
    let finish!: () => void;
    mockCleanup.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    const outcome = track(cleanupCocoWithTimeout());
    jest.advanceTimersByTime(4_999);
    await flush();
    expect(outcome()).toBe('pending');

    jest.advanceTimersByTime(1);
    await flush();
    expect(outcome()).toEqual({ value: undefined });
    expect(mockWarn.mock.calls).toEqual([
      ['profile.orchestrator.cleanup_timeout', { timeoutMs: 5_000 }],
    ]);

    finish();
    await flush();
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });
});
