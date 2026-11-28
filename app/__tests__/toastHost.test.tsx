/**
 * @jest-environment node
 */

/**
 * The house toast stack (`ToastHost`), driven through the popup bridge the
 * app uses (`showToast` / `showCustomToast`). Every toast is drawn once (no
 * measuring copy a screen reader could find twice); a toast's own `hide()`
 * removes only that toast; a toast hides itself after 4 s unless it is
 * persistent; at most three are kept, the oldest dropped first.
 */

import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { showCustomToast, showToast } from '@/shared/lib/popup/popups/bridge';
import { ToastHost } from '@/shared/ui/composed/ToastHost';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-reanimated', () => require('./helpers/sheetRuntimeMocks').reanimated);
jest.mock(
  'react-native-gesture-handler',
  () => require('./helpers/sheetRuntimeMocks').gestureHandler
);
jest.mock('react-native-screens', () => require('./helpers/sheetRuntimeMocks').screens);
jest.mock('react-native-worklets', () => require('./helpers/sheetRuntimeMocks').worklets);
jest.mock('react-native-safe-area-context', () => require('./helpers/sheetRuntimeMocks').safeArea);
jest.mock(
  'react-native-keyboard-controller',
  () => require('./helpers/sheetRuntimeMocks').keyboardController
);

jest.mock('@/shared/lib/logger', () => {
  const logger = { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() };
  return { popupLog: logger, storeLog: logger, log: { ...logger, child: () => logger } };
});
// The standard toast's look is not under test; its label is.
jest.mock('@/shared/lib/popup/CompactToast', () => ({
  CompactToast: ({ label }: { label: string }) =>
    jest
      .requireActual<typeof import('react')>('react')
      .createElement('Toast', { testID: `toast-${label}`, accessibilityLabel: label }),
}));
jest.mock('@/shared/lib/popup/E2EToastProbe', () => ({ E2EStaticToastRenderMarker: () => null }));

type Hide = (ids?: string | string[] | 'all') => void;

let renderer: TestRenderer.ReactTestRenderer | undefined;
const hides = new Map<string, Hide>();

function mountHost() {
  act(() => {
    renderer = TestRenderer.create(<ToastHost />);
  });
  return renderer!;
}

/** Shows a custom toast drawn as one element labelled `name`; records its `hide`. */
function showNamed(
  name: string,
  options: { durationMs?: number | 'persistent'; onHide?: () => void } = {}
) {
  let takeDown: (() => void) | null = null;
  act(() => {
    takeDown = showCustomToast({
      ...options,
      component: ({ hide }) => {
        hides.set(name, hide);
        return React.createElement('Toast', { testID: `toast-${name}`, accessibilityLabel: name });
      },
    });
  });
  return takeDown as (() => void) | null;
}

const drawn = (r: TestRenderer.ReactTestRenderer, name: string) =>
  r.root.findAll((node) => node.props.testID === `toast-${name}`).length;

describe('ToastHost', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    hides.clear();
  });

  afterEach(() => {
    act(() => {
      renderer?.unmount();
      renderer = undefined;
    });
    jest.useRealTimers();
  });

  it('draws nothing until a toast is shown', () => {
    const r = mountHost();
    expect(r.toJSON()).toBeNull();
  });

  it('draws a standard toast exactly once', () => {
    const r = mountHost();
    act(() => showToast({ variant: 'success', label: 'Copied' }));
    expect(drawn(r, 'Copied')).toBe(1);
    expect(r.root.findAll((node) => node.props.accessibilityLabel === 'Copied')).toHaveLength(1);
  });

  it('draws a custom toast exactly once', () => {
    const r = mountHost();
    showNamed('Saved');
    expect(drawn(r, 'Saved')).toBe(1);
    expect(r.root.findAll((node) => node.props.accessibilityLabel === 'Saved')).toHaveLength(1);
  });

  it('removes only the toast whose own hide() was called', () => {
    const r = mountHost();
    const firstHidden = jest.fn();
    const secondHidden = jest.fn();
    showNamed('first', { durationMs: 'persistent', onHide: firstHidden });
    showNamed('second', { durationMs: 'persistent', onHide: secondHidden });
    expect(drawn(r, 'first')).toBe(1);
    expect(drawn(r, 'second')).toBe(1);

    // The older toast, behind the front one, hides itself.
    act(() => hides.get('first')!());
    expect(drawn(r, 'first')).toBe(0);
    expect(drawn(r, 'second')).toBe(1);
    expect(firstHidden).toHaveBeenCalledTimes(1);
    expect(secondHidden).not.toHaveBeenCalled();

    // A second call for a toast already gone changes nothing.
    act(() => hides.get('first')!());
    expect(firstHidden).toHaveBeenCalledTimes(1);
    expect(drawn(r, 'second')).toBe(1);
  });

  it('lets whoever showed a toast take it down, once', () => {
    const r = mountHost();
    const onHide = jest.fn();
    const takeDown = showNamed('mine', { durationMs: 'persistent', onHide });
    showNamed('other', { durationMs: 'persistent' });

    act(() => takeDown!());
    expect(drawn(r, 'mine')).toBe(0);
    expect(drawn(r, 'other')).toBe(1);
    expect(onHide).toHaveBeenCalledTimes(1);
    act(() => takeDown!());
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  // A toast's own timers depend on `hide`: a new function each time another
  // toast came or went used to restart them (T4).
  it('gives a toast the same hide() for its whole life, whatever other toasts do', () => {
    mountHost();
    showNamed('steady', { durationMs: 'persistent' });
    const first = hides.get('steady');
    showNamed('passing', { durationMs: 'persistent' });
    act(() => hides.get('passing')!());
    showNamed('another', { durationMs: 'persistent' });
    expect(hides.get('steady')).toBe(first);
  });

  it('hides a toast after 4 s, and keeps a persistent one', () => {
    const r = mountHost();
    const onHide = jest.fn();
    showNamed('brief', { onHide });
    showNamed('pinned', { durationMs: 'persistent' });
    act(() => jest.advanceTimersByTime(3999));
    expect(drawn(r, 'brief')).toBe(1);
    expect(onHide).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(drawn(r, 'brief')).toBe(0);
    expect(onHide).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(60_000));
    expect(drawn(r, 'pinned')).toBe(1);
  });

  it('honours a custom duration', () => {
    const r = mountHost();
    showNamed('quick', { durationMs: 1500 });
    act(() => jest.advanceTimersByTime(1499));
    expect(drawn(r, 'quick')).toBe(1);
    act(() => jest.advanceTimersByTime(1));
    expect(drawn(r, 'quick')).toBe(0);
  });

  it('keeps at most three toasts, dropping the oldest first', () => {
    const r = mountHost();
    const hidden = ['one', 'two', 'three', 'four'].map((name) => {
      const onHide = jest.fn();
      showNamed(name, { durationMs: 'persistent', onHide });
      return onHide;
    });
    expect(drawn(r, 'one')).toBe(0);
    expect(['two', 'three', 'four'].map((name) => drawn(r, name))).toEqual([1, 1, 1]);
    expect(hidden.map((onHide) => onHide.mock.calls.length)).toEqual([1, 0, 0, 0]);
  });

  it('lets the overlay outlive its last toast just long enough to animate it out', () => {
    const r = mountHost();
    showNamed('last');
    act(() => jest.advanceTimersByTime(4000));
    expect(drawn(r, 'last')).toBe(0);
    expect(r.toJSON()).not.toBeNull();
    act(() => jest.advanceTimersByTime(200));
    expect(r.toJSON()).toBeNull();
  });

  it('fires onHide for active toasts when ToastHost unmounts (account switch)', () => {
    const r = mountHost();
    const onHide = jest.fn();
    showNamed('swap-progress', { durationMs: 'persistent', onHide });
    expect(onHide).not.toHaveBeenCalled();
    act(() => r.unmount());
    renderer = undefined;
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('keeps the overlay non-modal on iOS and stacks above sheets on Android', () => {
    const prevOS = Platform.OS;
    try {
      Platform.OS = 'ios';
      const iosHost = mountHost();
      showNamed('ios-toast', { durationMs: 'persistent' });
      const overlay = iosHost.root.findByType('FullWindowOverlay' as never);
      expect(overlay.props.unstable_accessibilityContainerViewIsModal).toBe(false);
      act(() => iosHost.unmount());
      renderer = undefined;

      Platform.OS = 'android';
      const androidHost = mountHost();
      showNamed('android-toast', { durationMs: 'persistent' });
      const rootView = androidHost.root.findByType('GestureHandlerRootView' as never);
      const flat = StyleSheet.flatten(rootView.props.style);
      expect(flat.zIndex).toBeGreaterThan(1000);
      expect(flat.elevation).toBeGreaterThan(1000);
    } finally {
      Platform.OS = prevOS;
    }
  });
});
