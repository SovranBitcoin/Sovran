/**
 * @jest-environment node
 *
 * The end of a page transition.
 *
 * `nav.transition` times a route change up to the destination's first commit.
 * The page is still sliding in after that, and a tap sent during the slide can
 * miss. The native stack says when the animation starts and ends; `Screen` logs
 * both, so a test runner can wait for the page to stop moving.
 */
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react-native';

import { log } from '@/shared/lib/logger';
import { useScreenPerf } from '@/shared/lib/loggerScreen';

type Listener = (event: { data: { closing: boolean } }) => void;
const mockListeners = new Map<string, Listener>();
const mockRemoved: string[] = [];

jest.mock('expo-router', () => ({ useNavigationContainerRef: () => null }));
jest.mock('expo-router/react-navigation', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    NavigationContext: React.createContext({
      addListener: (type: string, listener: Listener) => {
        mockListeners.set(type, listener);
        return () => mockRemoved.push(type);
      },
    }),
  };
});

const wrapper = ({ children }: { children: ReactNode }) => children;

describe('page transition logging', () => {
  let debug: jest.SpyInstance;
  let now = 0;

  beforeEach(() => {
    mockListeners.clear();
    mockRemoved.length = 0;
    now = 1000;
    jest.spyOn(performance, 'now').mockImplementation(() => now);
    debug = jest.spyOn(log, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const transitionEntries = () =>
    debug.mock.calls.filter(([event]) => String(event).startsWith('nav.transition.'));

  it('logs when the page starts moving and when it has stopped, with how long it took', () => {
    renderHook(() => useScreenPerf('SendScreen', true, () => ({})), { wrapper });

    mockListeners.get('transitionStart')?.({ data: { closing: false } });
    now += 352;
    mockListeners.get('transitionEnd')?.({ data: { closing: false } });

    expect(transitionEntries()).toEqual([
      ['nav.transition.start', { screen: 'SendScreen', closing: false }],
      ['nav.transition.end', { screen: 'SendScreen', closing: false, duration_ms: 352 }],
    ]);
  });

  it('says a page is closing when it is the one leaving', () => {
    renderHook(() => useScreenPerf('SendScreen', true, () => ({})), { wrapper });

    mockListeners.get('transitionStart')?.({ data: { closing: true } });
    now += 300;
    mockListeners.get('transitionEnd')?.({ data: { closing: true } });

    expect(transitionEntries()).toEqual([
      ['nav.transition.start', { screen: 'SendScreen', closing: true }],
      ['nav.transition.end', { screen: 'SendScreen', closing: true, duration_ms: 300 }],
    ]);
  });

  it('stops listening when the page is gone', () => {
    const { unmount } = renderHook(() => useScreenPerf('SendScreen', true, () => ({})), {
      wrapper,
    });

    unmount();

    expect(mockRemoved.sort()).toEqual(['transitionEnd', 'transitionStart']);
  });
});
