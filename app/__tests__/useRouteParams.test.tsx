/**
 * @jest-environment jsdom
 */

import { z } from 'zod';
import TestRenderer, { act } from 'react-test-renderer';
import { useRouteParams, type UseRouteParamsOptions } from '@/shared/lib/nav/useRouteParams';

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn(() => true);
const mockGuardedBack = jest.fn();
const paramsRef: { current: Record<string, string | string[] | undefined> } = { current: {} };
/** When set, every `useLocalSearchParams()` call gets its own object, as Expo Router does. */
let mockFreshParamsPerCall = false;
const mockWarn = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    back: (...args: unknown[]) => mockBack(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    canGoBack: () => mockCanGoBack(),
  },
  useLocalSearchParams: () =>
    mockFreshParamsPerCall ? { ...paramsRef.current } : paramsRef.current,
  usePathname: () => '',
}));

// The guarded router dedupes repeated calls within 600ms, so a recovery
// `back()` dispatched right after the navigation that opened the bad route
// would be swallowed. Recovery must never go through it.
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: {
    back: (...args: unknown[]) => mockGuardedBack(...args),
    replace: jest.fn(),
    canGoBack: () => true,
    raw: jest.requireMock<{ router: unknown }>('expo-router').router,
  },
}));

jest.mock('@/shared/lib/logger', () => ({
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: (...a: unknown[]) => mockWarn(...a),
    error: jest.fn(),
  },
}));

jest.mock('@sovranbitcoin/schemas', () => ({
  loggableIssues: (e: { issues: { path: (string | number)[]; code: string }[] }) =>
    e.issues.slice(0, 10).map((i) => ({ path: i.path.join('.') || '<root>', code: i.code })),
}));

const Schema = z.object({
  pubkey: z.string().regex(/^[0-9a-f]{64}$/, '64-hex'),
});

function Probe({
  options,
  onResult,
}: {
  options: UseRouteParamsOptions;
  onResult: (v: unknown) => void;
}) {
  const result = useRouteParams(Schema, options);
  onResult(result);
  return null;
}

describe('useRouteParams', () => {
  // Each test starts well past the previous one's coalescing window.
  let clock = 0;
  beforeAll(() => {
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
  });
  afterAll(() => {
    jest.restoreAllMocks();
  });
  beforeEach(() => {
    clock += 10_000;
    mockFreshParamsPerCall = false;
    mockBack.mockReset();
    mockReplace.mockReset();
    mockGuardedBack.mockReset();
    mockCanGoBack.mockReset();
    mockCanGoBack.mockReturnValue(true);
    mockWarn.mockReset();
  });

  it('returns parsed data when params validate', () => {
    paramsRef.current = { pubkey: 'a'.repeat(64) };
    const onResult = jest.fn();
    act(() => {
      TestRenderer.create(<Probe options={{ where: 'test.route' }} onResult={onResult} />);
    });
    expect(onResult).toHaveBeenCalledWith({ pubkey: 'a'.repeat(64) });
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('returns null and routes back on invalid params with PII-safe log', () => {
    paramsRef.current = { pubkey: 'not-hex' };
    const onResult = jest.fn();
    act(() => {
      TestRenderer.create(<Probe options={{ where: 'test.route' }} onResult={onResult} />);
    });
    expect(onResult).toHaveBeenCalledWith(null);
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockGuardedBack).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledTimes(1);
    const [event, payload] = mockWarn.mock.calls[0] as [string, { issues: unknown[] }];
    expect(event).toBe('nav.test.route.invalid_params');
    expect(Array.isArray(payload.issues)).toBe(true);
    expect(payload.issues.length).toBeGreaterThan(0);
  });

  it('recovers to the wallet when a cold-start deep link has invalid params', () => {
    // Opened straight from a link: there is nothing to go back to, so a
    // back() would leave the blank route on screen.
    paramsRef.current = { pubkey: 'not-hex' };
    mockCanGoBack.mockReturnValue(false);
    const onResult = jest.fn();
    act(() => {
      TestRenderer.create(<Probe options={{ where: 'test.route' }} onResult={onResult} />);
    });
    expect(onResult).toHaveBeenCalledWith(null);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockGuardedBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('invokes a custom onInvalid callback and skips router.back', () => {
    paramsRef.current = { pubkey: 'still-not-hex' };
    const onInvalid = jest.fn();
    act(() => {
      TestRenderer.create(
        <Probe options={{ where: 'test.route', onInvalid }} onResult={() => undefined} />
      );
    });
    expect(onInvalid).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('coalesces duplicate invalid-param back() calls from nested hooks in the same commit', () => {
    paramsRef.current = { pubkey: 'not-hex' };
    act(() => {
      TestRenderer.create(
        <>
          <Probe options={{ where: 'wrapper.route' }} onResult={() => undefined} />
          <Probe options={{ where: 'screen.route' }} onResult={() => undefined} />
        </>
      );
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('coalesces two hooks given distinct but equal params objects into one back()', () => {
    mockFreshParamsPerCall = true;
    paramsRef.current = { pubkey: 'not-hex' };
    act(() => {
      TestRenderer.create(
        <>
          <Probe options={{ where: 'wrapper.route' }} onResult={() => undefined} />
          <Probe options={{ where: 'screen.route' }} onResult={() => undefined} />
        </>
      );
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('still recovers again for the same bad params once the window has passed', () => {
    mockFreshParamsPerCall = true;
    paramsRef.current = { pubkey: 'not-hex' };
    act(() => {
      TestRenderer.create(<Probe options={{ where: 'screen.route' }} onResult={() => undefined} />);
    });
    clock += 1_000;
    act(() => {
      TestRenderer.create(<Probe options={{ where: 'screen.route' }} onResult={() => undefined} />);
    });
    expect(mockBack).toHaveBeenCalledTimes(2);
  });

  it('does not coalesce different bad params', () => {
    mockFreshParamsPerCall = true;
    paramsRef.current = { pubkey: 'not-hex' };
    act(() => {
      TestRenderer.create(<Probe options={{ where: 'a.route' }} onResult={() => undefined} />);
    });
    paramsRef.current = { pubkey: 'also-not-hex' };
    act(() => {
      TestRenderer.create(<Probe options={{ where: 'b.route' }} onResult={() => undefined} />);
    });
    expect(mockBack).toHaveBeenCalledTimes(2);
  });
});
