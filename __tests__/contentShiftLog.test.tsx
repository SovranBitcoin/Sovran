/**
 * @jest-environment node
 *
 * `useShiftLogger` is the change-gated reporter behind every `*.shift.*`
 * content-shift log (feed rows, images, thread phases, reply bar, composer).
 * Its whole value is that it only emits on a *real* change and tags each entry
 * with prev/delta/firstMeasure — so these tests lock that contract.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { useShiftLogger, urlHost } from '@/features/feed/lib/contentShiftLog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockInfo = jest.fn();
jest.mock('@/shared/lib/logger', () => ({
  feedLog: {
    info: (event: string, params?: Record<string, unknown>) => mockInfo(event, params),
  },
}));

/** Drives a reporter from outside React so a test can fire reports in order. */
function harness(): { report: ReturnType<typeof useShiftLogger>['report'] } {
  const ref: { report: ReturnType<typeof useShiftLogger>['report'] } = {
    report: () => undefined,
  };
  function Probe() {
    const logger = useShiftLogger('Probe');
    ref.report = logger.report;
    return null;
  }
  act(() => {
    TestRenderer.create(<Probe />);
  });
  return ref;
}

beforeEach(() => mockInfo.mockClear());

describe('useShiftLogger.report', () => {
  it('logs the first measurement with firstMeasure and null prev/delta', () => {
    const { report } = harness();
    act(() => report('feed.shift.note.height', 'evt1', 120));

    expect(mockInfo).toHaveBeenCalledTimes(1);
    const [event, params] = mockInfo.mock.calls[0];
    expect(event).toBe('feed.shift.note.height');
    expect(params).toMatchObject({
      component: 'Probe',
      key: 'evt1',
      value: 120,
      prev: null,
      delta: null,
      firstMeasure: true,
    });
  });

  it('does not log when the value is unchanged (sub-pixel)', () => {
    const { report } = harness();
    act(() => report('e', 'k', 100));
    act(() => report('e', 'k', 100.2)); // within epsilon
    expect(mockInfo).toHaveBeenCalledTimes(1);
  });

  it('logs a real shift with prev and signed delta', () => {
    const { report } = harness();
    act(() => report('e', 'k', 100));
    act(() => report('e', 'k', 160));
    act(() => report('e', 'k', 140));

    expect(mockInfo).toHaveBeenCalledTimes(3);
    expect(mockInfo.mock.calls[1][1]).toMatchObject({
      prev: 100,
      value: 160,
      delta: 60,
      firstMeasure: false,
    });
    expect(mockInfo.mock.calls[2][1]).toMatchObject({
      prev: 160,
      value: 140,
      delta: -20,
      firstMeasure: false,
    });
  });

  it('tracks each key independently', () => {
    const { report } = harness();
    act(() => report('e', 'a', 10));
    act(() => report('e', 'b', 20));
    act(() => report('e', 'a', 10)); // unchanged for a
    expect(mockInfo).toHaveBeenCalledTimes(2);
  });

  it('merges surface-specific extra params and ignores non-finite values', () => {
    const { report } = harness();
    act(() => report('feed.shift.image.aspect', 'url', 1.5, { host: 'i.example' }));
    act(() => report('e', 'k', Number.NaN));
    expect(mockInfo).toHaveBeenCalledTimes(1);
    expect(mockInfo.mock.calls[0][1]).toMatchObject({ host: 'i.example', value: 1.5 });
  });
});

describe('urlHost', () => {
  it('extracts the host from a media url', () => {
    expect(urlHost('https://cdn.example.com/a/b.jpg?x=1')).toBe('cdn.example.com');
    expect(urlHost('wss://relay.example.net')).toBe('relay.example.net');
  });

  it('returns "unknown" for a string without a scheme', () => {
    expect(urlHost('not-a-url')).toBe('unknown');
  });
});
