/** @jest-environment node */
import {
  countIdleWork,
  countTimerCallbacks,
  readIdleCounters,
  resetIdleCounters,
} from '@/shared/lib/loggerIdleCounters';

beforeEach(() => resetIdleCounters());

it('counts work per counter in a dev build', () => {
  countIdleWork('secure_vault.read');
  countIdleWork('secure_vault.read');
  countIdleWork('store.write', 3);
  expect(readIdleCounters()).toEqual({ 'secure_vault.read': 2, 'store.write': 3 });
  resetIdleCounters();
  expect(readIdleCounters()).toEqual({});
});

it('counts each timer callback that fires', () => {
  jest.useFakeTimers();
  try {
    countTimerCallbacks();
    const interval = setInterval(() => undefined, 1_000);
    setTimeout(() => undefined, 500);
    jest.advanceTimersByTime(3_000);
    clearInterval(interval);
    expect(readIdleCounters()['timer.fired']).toBe(4);
  } finally {
    jest.useRealTimers();
  }
});
