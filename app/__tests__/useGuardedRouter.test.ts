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
    guardedRouter.push('/feed');
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/feed');
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
      guardedRouter.push('/share');
      jest.setSystemTime(start + 700);
      guardedRouter.push('/share');
      expect(mockPush).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('treats push and navigate to the same href as distinct gates', () => {
    guardedRouter.push('/contacts');
    guardedRouter.navigate('/contacts');
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

it('suppresses the same route even if param object construction orders differ', () => {
  __resetGuardForTests();
  mockPush.mockReset();
  guardedRouter.push({ pathname: '/profile', params: { pubkey: 'abc', tab: 'posts' } });
  guardedRouter.push({ params: { tab: 'posts', pubkey: 'abc' }, pathname: '/profile' });
  expect(mockPush).toHaveBeenCalledTimes(1);
});

it('requires the explicit raw escape hatch for intentional immediate duplicate pushes', () => {
  __resetGuardForTests();
  mockPush.mockReset();
  guardedRouter.raw.push('/profile');
  guardedRouter.raw.push('/profile');
  expect(mockPush).toHaveBeenCalledTimes(2);
});

it('keeps one destination entry in the installed Expo stack for a rapid repeated push', () => {
  // Exercise SDK 56's actual reducer: raw PUSH actions really do append twice.
  const { StackRouter } = jest.requireActual(
    'expo-router/build/react-navigation/routers/StackRouter'
  );
  const stack = StackRouter({ initialRouteName: 'receive' });
  const options = { routeNames: ['receive', 'mint-add'], routeParamList: {}, routeGetIdList: {} };
  const initial = stack.getInitialState(options);
  const action = { type: 'PUSH', payload: { name: 'mint-add', params: { method: 'bolt12' } } };
  const rawTwice = stack.getStateForAction(
    stack.getStateForAction(initial, action, options),
    action,
    options
  );
  expect(rawTwice.routes.map((route: { name: string }) => route.name)).toEqual([
    'receive',
    'mint-add',
    'mint-add',
  ]);

  let state = initial;
  __resetGuardForTests();
  mockPush.mockReset().mockImplementation(() => {
    state = stack.getStateForAction(state, action, options);
  });
  guardedRouter.push('/(mint-flow)/add');
  guardedRouter.push('/(mint-flow)/add');
  expect(state.routes.map((route: { name: string }) => route.name)).toEqual([
    'receive',
    'mint-add',
  ]);
});
