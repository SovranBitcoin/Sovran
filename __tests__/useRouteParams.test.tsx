/**
 * @jest-environment jsdom
 */

import React from 'react';
import { z } from 'zod';
import TestRenderer, { act } from 'react-test-renderer';
import { useRouteParams, type UseRouteParamsOptions } from '@/shared/lib/nav/useRouteParams';

const mockBack = jest.fn();
const paramsRef: { current: Record<string, string | string[] | undefined> } = { current: {} };
const mockWarn = jest.fn();

jest.mock('expo-router', () => ({
  router: { back: (...args: unknown[]) => mockBack(...args) },
  useLocalSearchParams: () => paramsRef.current,
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
  beforeEach(() => {
    mockBack.mockReset();
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
    expect(mockWarn).toHaveBeenCalledTimes(1);
    const [event, payload] = mockWarn.mock.calls[0] as [string, { issues: unknown[] }];
    expect(event).toBe('nav.test.route.invalid_params');
    expect(Array.isArray(payload.issues)).toBe(true);
    expect(payload.issues.length).toBeGreaterThan(0);
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
  });
});
