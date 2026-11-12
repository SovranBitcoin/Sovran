/**
 * @jest-environment node
 *
 * Characterization of `guardedRouter`'s double-tap cooldown: which calls reach
 * expo-router's `router` and which are dropped, by method, destination and
 * time since the last call that went through. Only expo-router is replaced.
 */

import { guardedRouter } from '@/shared/hooks/useGuardedRouter';

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    navigate: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    dismiss: jest.fn(),
    dismissAll: jest.fn(),
    dismissTo: jest.fn(),
    canGoBack: jest.fn(() => true),
    setParams: jest.fn(),
  },
}));
jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockRouter = (jest.requireMock('expo-router') as { router: Record<string, jest.Mock> })
  .router;

let now = 1_000_000;

beforeEach(() => {
  for (const fn of Object.values(mockRouter)) fn.mockClear();
  // Far past any earlier test's last call, so each case starts outside the cooldown.
  now += 10_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('guardedRouter cooldown', () => {
  it('drops the same navigation repeated inside 600 ms and lets it through at 600 ms', () => {
    guardedRouter.push('/(send-flow)/send');
    now += 599;
    guardedRouter.push('/(send-flow)/send');
    expect(mockRouter.push).toHaveBeenCalledTimes(1);

    now += 1;
    guardedRouter.push('/(send-flow)/send');
    expect(mockRouter.push).toHaveBeenCalledTimes(2);
  });

  it('measures the cooldown from the last call that went through, not from a dropped one', () => {
    guardedRouter.navigate('/camera');
    now += 400;
    guardedRouter.navigate('/camera');
    now += 200;
    guardedRouter.navigate('/camera');

    expect(mockRouter.navigate).toHaveBeenCalledTimes(2);
  });

  it('treats object hrefs with the same keys in another order as the same destination', () => {
    guardedRouter.navigate({ pathname: '/camera', params: { unit: 'sat', mode: 'scan' } });
    now += 10;
    guardedRouter.navigate({ params: { mode: 'scan', unit: 'sat' }, pathname: '/camera' });

    expect(mockRouter.navigate).toHaveBeenCalledTimes(1);
  });

  it('lets a different destination or method through inside the cooldown', () => {
    guardedRouter.navigate({ pathname: '/camera', params: { unit: 'sat' } });
    now += 10;
    guardedRouter.navigate({ pathname: '/camera', params: { unit: 'usd' } });
    now += 10;
    guardedRouter.push({ pathname: '/camera', params: { unit: 'usd' } });

    expect(mockRouter.navigate).toHaveBeenCalledTimes(2);
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
  });

  it('remembers only the last destination, so A, B, A inside the cooldown all go through', () => {
    guardedRouter.push('/camera');
    now += 10;
    guardedRouter.push('/composer');
    now += 10;
    guardedRouter.push('/camera');

    expect(mockRouter.push.mock.calls).toEqual([['/camera'], ['/composer'], ['/camera']]);
  });

  it('drops a second back inside the cooldown', () => {
    guardedRouter.back();
    now += 100;
    guardedRouter.back();

    // QUIRK: two deliberate backs (closing two sheets in a row) inside 600 ms lose the
    // second; callers that need both use `guardedRouter.raw`.
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  it.each(['dismiss', 'dismissAll', 'dismissTo', 'replace'] as const)(
    'guards %s the same way',
    (method) => {
      const call = guardedRouter[method] as (...args: unknown[]) => unknown;
      call('/x');
      now += 10;
      call('/x');

      expect(mockRouter[method]).toHaveBeenCalledTimes(1);
    }
  );

  it('passes the router through unguarded via raw and for other properties', () => {
    guardedRouter.raw.back();
    guardedRouter.raw.back();
    expect(mockRouter.back).toHaveBeenCalledTimes(2);

    expect(guardedRouter.canGoBack()).toBe(true);
    guardedRouter.setParams({ a: '1' });
    guardedRouter.setParams({ a: '1' });
    expect(mockRouter.setParams).toHaveBeenCalledTimes(2);
  });

  it('returns nothing for a dropped call and the router result for one that goes through', () => {
    mockRouter.push.mockReturnValueOnce('pushed');
    expect(guardedRouter.push('/camera')).toBe('pushed');
    now += 1;
    expect(guardedRouter.push('/camera')).toBeUndefined();
  });
});
