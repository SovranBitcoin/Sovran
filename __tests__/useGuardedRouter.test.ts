/**
 * @jest-environment node
 */

import { guardedRouter, __resetGuardForTests } from '@/shared/hooks/useGuardedRouter';

const mockPush = jest.fn();
const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockDismiss = jest.fn();
const mockDismissTo = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    navigate: (...args: unknown[]) => mockNavigate(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    back: (...args: unknown[]) => mockBack(...args),
    dismiss: (...args: unknown[]) => mockDismiss(...args),
    dismissTo: (...args: unknown[]) => mockDismissTo(...args),
  },
}));

jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('guardedRouter', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockNavigate.mockReset();
    mockReplace.mockReset();
    mockBack.mockReset();
    mockDismiss.mockReset();
    mockDismissTo.mockReset();
    __resetGuardForTests();
  });

  it('forwards a single push to the underlying router', () => {
    guardedRouter.push('/home');
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/home');
  });

  it('suppresses a duplicate push within the cooldown window', () => {
    guardedRouter.push('/profile?id=1');
    guardedRouter.push('/profile?id=1');
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('allows a push to a different destination immediately', () => {
    guardedRouter.push('/profile?id=1');
    guardedRouter.push('/profile?id=2');
    expect(mockPush).toHaveBeenCalledTimes(2);
  });

  it('allows the same destination after the cooldown elapses', () => {
    jest.useFakeTimers();
    try {
      const start = Date.now();
      jest.setSystemTime(start);
      guardedRouter.push('/wallet');
      jest.setSystemTime(start + 700);
      guardedRouter.push('/wallet');
      expect(mockPush).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('treats push and navigate to the same href as distinct gates', () => {
    guardedRouter.push('/x');
    guardedRouter.navigate('/x');
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it('suppresses duplicate object hrefs by JSON identity', () => {
    guardedRouter.push({ pathname: '/profile', params: { pubkey: 'abc' } });
    guardedRouter.push({ pathname: '/profile', params: { pubkey: 'abc' } });
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('lets two different object hrefs through', () => {
    guardedRouter.push({ pathname: '/profile', params: { pubkey: 'abc' } });
    guardedRouter.push({ pathname: '/profile', params: { pubkey: 'xyz' } });
    expect(mockPush).toHaveBeenCalledTimes(2);
  });
});
