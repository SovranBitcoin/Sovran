/**
 * @jest-environment node
 *
 * A screen that mounts slowly outlives the 600 ms double-tap cooldown, so a
 * second tap on "Add mints" used to push a second copy of the screen already
 * on top. A push to the route that is already focused (same path, groups and
 * params) is dropped however late it comes; anything else still goes through.
 */
import { guardedRouter } from '@/shared/hooks/useGuardedRouter';

let mockFocused = {
  pathname: '/',
  segments: ['(drawer)', '(tabs)', 'index'],
  searchParams: new URLSearchParams(),
};

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), back: jest.fn() },
}));
jest.mock('expo-router/build/global-state/router-store', () => ({
  store: { getRouteInfo: () => mockFocused },
}));
jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { debug: jest.fn() },
}));

const push = (jest.requireMock('expo-router') as { router: { push: jest.Mock } }).router.push;
let now = 1_000_000;

function focus(pathname: string, segments: string[], params: Record<string, string> = {}) {
  mockFocused = { pathname, segments, searchParams: new URLSearchParams(params) };
}

beforeEach(() => {
  push.mockClear();
  now += 10_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  focus('/', ['(drawer)', '(tabs)', 'index']);
});
afterEach(() => jest.restoreAllMocks());

it('drops a second push 700 ms later once the first one has focused the route', () => {
  guardedRouter.push('/(mint-flow)/add');
  focus('/add', ['(mint-flow)', 'add']);
  now += 700;
  guardedRouter.push('/(mint-flow)/add');
  expect(push).toHaveBeenCalledTimes(1);
});

it('compares params too, so the same screen for other params still opens', () => {
  focus('/add', ['(mint-flow)', 'add'], { method: 'bolt11', unit: 'sat' });
  guardedRouter.push({ pathname: '/(mint-flow)/add', params: { unit: 'sat', method: 'bolt11' } });
  expect(push).toHaveBeenCalledTimes(0);
  now += 700;
  guardedRouter.push({ pathname: '/(mint-flow)/add', params: { method: 'bolt12', unit: 'sat' } });
  expect(push).toHaveBeenCalledTimes(1);
});

it('reads the params of a string href, encoded or not', () => {
  focus('/add', ['(mint-flow)', 'add'], { note: 'two words', unit: 'sat' });
  guardedRouter.push('/(mint-flow)/add?unit=sat&note=two%20words' as never);
  now += 700;
  guardedRouter.push('/(mint-flow)/add?unit=usd&note=two%20words' as never);
  expect(push).toHaveBeenCalledTimes(1);
  expect(push).toHaveBeenLastCalledWith('/(mint-flow)/add?unit=usd&note=two%20words');
});

it('fills dynamic segments before comparing', () => {
  // The app has no dynamic route today; the guard must still read one right.
  const user = (pubkey: string): never => {
    const href: unknown = { pathname: '/(user-flow)/user/[pubkey]', params: { pubkey } };
    return href as never;
  };
  focus('/user/abc', ['(user-flow)', 'user', '[pubkey]']);
  guardedRouter.push(user('abc'));
  now += 700;
  guardedRouter.push(user('def'));
  expect(push).toHaveBeenCalledTimes(1);
  expect(push).toHaveBeenLastCalledWith({
    pathname: '/(user-flow)/user/[pubkey]',
    params: { pubkey: 'def' },
  });
});

it('never takes a group that is not on screen for the focused route', () => {
  // `/(map-flow)` resolves to `/` like the wallet home; it is another screen.
  guardedRouter.push('/(map-flow)');
  expect(push).toHaveBeenCalledTimes(1);
});

it('lets the push through when the focused route cannot be read', () => {
  (mockFocused as unknown) = undefined;
  guardedRouter.push('/(mint-flow)/add');
  expect(push).toHaveBeenCalledTimes(1);
});

it('never mistakes an encoded & inside one value for a second param', () => {
  focus('/transactions', ['(drawer)', '(tabs)', 'transactions'], {
    filterCounterparty: 'a&filterMintUrl=b',
  });
  guardedRouter.push('/transactions?filterCounterparty=a&filterMintUrl=b' as never);
  expect(push).toHaveBeenCalledTimes(1);
});

it('keeps the order of a repeated param', () => {
  mockFocused = {
    pathname: '/transactions',
    segments: ['(drawer)', '(tabs)', 'transactions'],
    searchParams: new URLSearchParams('tag=b&tag=a'),
  };
  guardedRouter.push('/transactions?tag=b&tag=a' as never);
  expect(push).toHaveBeenCalledTimes(0);
  now += 700;
  guardedRouter.push('/transactions?tag=a&tag=b' as never);
  expect(push).toHaveBeenCalledTimes(1);
});
